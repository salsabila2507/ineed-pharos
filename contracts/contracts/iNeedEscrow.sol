// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract iNeedEscrow {
    enum TaskStatus { Created, Funded, Open, Accepted, Submitted, Review, Completed, Disputed, Resolved, Cancelled }
    enum RewardModel { Single, Multiple }
    enum WinnerSelection { CreatorSelect, RandomSelect, ScoreBased, AutoTimeout }
    enum AutoTimeoutAction { PayAll, Refund, FirstSubmission }
    enum DisputeRuling { InFavorOfParticipant, InFavorOfCreator, Split }

    struct Task {
        address creator;
        uint256 rewardTotal;
        RewardModel rewardModel;
        bytes rewardConfig;
        WinnerSelection winnerSelection;
        uint256 deadline;
        uint256 reviewDeadline;
        TaskStatus status;
        uint256 maxParticipants;
        uint256 participantCount;
        uint256 submissionCount;
        uint16 feeBps;
        address feeTreasury;
        bool winnersSelected;
        AutoTimeoutAction timeoutAction;
    }

    struct Escrow {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 refundedAmount;
        uint256 feeCollected;
    }

    struct Submission {
        address submitter;
        bytes32 contentHash;
        uint256 timestamp;
        bool isWinner;
    }

    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => Escrow) public escrows;
    mapping(uint256 => address[]) public participants;
    mapping(uint256 => mapping(address => bool)) public hasAccepted;
    mapping(uint256 => Submission[]) public submissions;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => bool) public isDisputed;

    uint16 public feeBps = 200;
    address public feeTreasury;
    uint16 public immutable maxFeeBps = 1000;
    address public admin;

    bool private _reentrant;

    modifier nonReentrant() {
        require(!_reentrant, "ReentrancyGuard: reentrant call");
        _reentrant = true;
        _;
        _reentrant = false;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyCreator(uint256 taskId) {
        require(msg.sender == tasks[taskId].creator, "Only creator");
        _;
    }

    event TaskCreated(uint256 indexed taskId, address indexed creator, uint256 rewardTotal, uint256 deadline);
    event TaskFunded(uint256 indexed taskId, uint256 amount);
    event TaskAccepted(uint256 indexed taskId, address indexed participant);
    event SubmissionUploaded(uint256 indexed taskId, address indexed submitter, bytes32 contentHash);
    event ReviewStarted(uint256 indexed taskId, uint256 deadline);
    event WinnerSelected(uint256 indexed taskId, address[] winners, uint8 method);
    event RewardReleased(uint256 indexed taskId, address indexed recipient, uint256 amount);
    event PlatformFeeCollected(uint256 indexed taskId, uint256 amount, address indexed treasury);
    event TaskRefunded(uint256 indexed taskId, uint256 amount, address indexed recipient);
    event DisputeRaised(uint256 indexed taskId, address indexed participant, bytes evidence);
    event DisputeResolved(uint256 indexed taskId, DisputeRuling ruling, uint256 amount);
    event AutoResolved(uint256 indexed taskId, AutoTimeoutAction action);
    event TaskCancelled(uint256 indexed taskId);
    event FeeBpsUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event FeeTreasuryUpdated(address oldTreasury, address newTreasury);

    constructor(address _feeTreasury) {
        require(_feeTreasury != address(0), "Treasury cannot be zero");
        admin = msg.sender;
        feeTreasury = _feeTreasury;
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        return amount * feeBps / 10000;
    }

    function createTask(
        uint256 rewardTotal_,
        RewardModel rewardModel_,
        bytes calldata rewardConfig_,
        WinnerSelection winnerSelection_,
        uint256 deadline_,
        uint256 reviewDeadline_,
        uint256 maxParticipants_
    ) external returns (uint256 taskId) {
        require(rewardTotal_ > 0, "Reward must be > 0");
        require(deadline_ > block.timestamp, "Deadline must be in the future");
        require(reviewDeadline_ > deadline_, "Review deadline must be after submission deadline");

        taskId = nextTaskId++;
        Task storage task = tasks[taskId];
        task.creator = msg.sender;
        task.rewardTotal = rewardTotal_;
        task.rewardModel = rewardModel_;
        task.rewardConfig = rewardConfig_;
        task.winnerSelection = winnerSelection_;
        task.deadline = deadline_;
        task.reviewDeadline = reviewDeadline_;
        task.status = TaskStatus.Created;
        task.maxParticipants = maxParticipants_;
        task.feeBps = feeBps;
        task.feeTreasury = feeTreasury;

        if (winnerSelection_ == WinnerSelection.AutoTimeout) {
            AutoTimeoutAction action = abi.decode(rewardConfig_, (AutoTimeoutAction));
            task.timeoutAction = action;
        }

        emit TaskCreated(taskId, msg.sender, rewardTotal_, deadline_);
    }

    function deposit(uint256 taskId) external payable onlyCreator(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Created, "Task not in Created state");
        require(msg.value == task.rewardTotal, "msg.value must equal rewardTotal");

        task.status = TaskStatus.Funded;

        Escrow storage escrow = escrows[taskId];
        escrow.totalAmount = msg.value;

        task.status = TaskStatus.Open;

        emit TaskFunded(taskId, msg.value);
    }

    function accept(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Open || task.status == TaskStatus.Accepted, "Task not open for acceptance");
        require(!hasAccepted[taskId][msg.sender], "Already accepted");

        if (task.maxParticipants > 0) {
            require(task.participantCount < task.maxParticipants, "Max participants reached");
        }

        if (task.status == TaskStatus.Open) {
            task.status = TaskStatus.Accepted;
        }

        hasAccepted[taskId][msg.sender] = true;
        participants[taskId].push(msg.sender);
        task.participantCount++;

        emit TaskAccepted(taskId, msg.sender);
    }

    function submit(uint256 taskId, bytes32 contentHash) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Accepted || task.status == TaskStatus.Submitted, "Task not accepting submissions");
        require(hasAccepted[taskId][msg.sender], "Not an accepted participant");
        require(!hasSubmitted[taskId][msg.sender], "Already submitted");
        require(block.timestamp <= task.deadline, "Submission deadline passed");

        if (task.status == TaskStatus.Accepted) {
            task.status = TaskStatus.Submitted;
        }

        hasSubmitted[taskId][msg.sender] = true;
        submissions[taskId].push(Submission({
            submitter: msg.sender,
            contentHash: contentHash,
            timestamp: block.timestamp,
            isWinner: false
        }));
        task.submissionCount++;

        emit SubmissionUploaded(taskId, msg.sender, contentHash);
    }

    function startReview(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Submitted, "Task not in Submitted state");
        require(task.submissionCount > 0, "No submissions to review");

        task.status = TaskStatus.Review;
        emit ReviewStarted(taskId, task.reviewDeadline);
    }

    function selectWinners(uint256 taskId, address[] calldata winnerAddresses) external onlyCreator(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Review, "Task not in Review state");
        require(winnerAddresses.length > 0, "Must select at least one winner");
        require(!task.winnersSelected, "Winners already selected");

        if (task.rewardModel == RewardModel.Single) {
            require(winnerAddresses.length == 1, "Single winner: must select exactly 1");
        }

        for (uint256 i = 0; i < winnerAddresses.length; i++) {
            address winner = winnerAddresses[i];
            require(hasAccepted[taskId][winner], "Winner not a participant");
            require(hasSubmitted[taskId][winner], "Winner has not submitted");
            for (uint256 j = 0; j < i; j++) {
                require(winnerAddresses[j] != winner, "Duplicate winner");
            }
        }

        Submission[] storage taskSubmissions = submissions[taskId];
        for (uint256 i = 0; i < taskSubmissions.length; i++) {
            for (uint256 j = 0; j < winnerAddresses.length; j++) {
                if (taskSubmissions[i].submitter == winnerAddresses[j]) {
                    taskSubmissions[i].isWinner = true;
                    break;
                }
            }
        }

        task.winnersSelected = true;
        emit WinnerSelected(taskId, winnerAddresses, uint8(task.winnerSelection));
    }

    function release(uint256 taskId) external onlyCreator(taskId) nonReentrant {
        Task storage task = tasks[taskId];
        require(!isDisputed[taskId], "Task is disputed");
        require(task.status == TaskStatus.Review, "Task not in Review state");
        require(task.winnersSelected, "Winners not selected");

        Escrow storage escrow = escrows[taskId];
        require(escrow.totalAmount > 0, "No funds to release");

        uint256 fee = task.rewardTotal * task.feeBps / 10000;
        uint256 payoutPool = task.rewardTotal - fee;

        Submission[] storage taskSubmissions = submissions[taskId];
        address[] memory winnerAddresses = new address[](task.submissionCount);
        uint256 winnerCount = 0;
        for (uint256 i = 0; i < task.submissionCount; i++) {
            if (taskSubmissions[i].isWinner) {
                winnerAddresses[winnerCount] = taskSubmissions[i].submitter;
                winnerCount++;
            }
        }
        require(winnerCount > 0, "No winners to pay");

        if (task.rewardModel == RewardModel.Single) {
            require(winnerCount == 1, "Expected 1 winner");
            _transferAndEmit(taskId, winnerAddresses[0], payoutPool, escrow);
        } else {
            (uint256 numWinners,,) = abi.decode(task.rewardConfig, (uint256, bool, uint256[]));
            require(winnerCount == numWinners, "Winner count mismatch");

            _distributeMultiple(taskId, task, winnerAddresses, winnerCount, payoutPool, escrow);
        }

        if (fee > 0) {
            _transferToTreasury(taskId, task.feeTreasury, fee, escrow);
        }

        task.status = TaskStatus.Completed;
    }

    function refund(uint256 taskId) external onlyCreator(taskId) nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Funded || task.status == TaskStatus.Open, "Cannot refund at current state");
        require(task.participantCount == 0, "Participants have already accepted");

        Escrow storage escrow = escrows[taskId];
        uint256 amount = escrow.totalAmount - escrow.refundedAmount;
        require(amount > 0, "No funds to refund");

        escrow.refundedAmount += amount;
        task.status = TaskStatus.Cancelled;

        _safeTransfer(task.creator, amount);

        emit TaskRefunded(taskId, amount, task.creator);
        emit TaskCancelled(taskId);
    }

    function raiseDispute(uint256 taskId, bytes calldata evidence) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Review, "Task not in Review state");
        require(hasAccepted[taskId][msg.sender], "Not a participant");
        require(hasSubmitted[taskId][msg.sender], "No submission found");

        bool isWinner = false;
        Submission[] storage taskSubmissions = submissions[taskId];
        for (uint256 i = 0; i < taskSubmissions.length; i++) {
            if (taskSubmissions[i].submitter == msg.sender) {
                isWinner = taskSubmissions[i].isWinner;
                break;
            }
        }
        require(!isWinner, "Winner cannot dispute");

        isDisputed[taskId] = true;
        task.status = TaskStatus.Disputed;

        emit DisputeRaised(taskId, msg.sender, evidence);
    }

    function resolveDispute(
        uint256 taskId,
        DisputeRuling ruling,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAdmin nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Disputed, "Not in Disputed state");

        Escrow storage escrow = escrows[taskId];
        uint256 balance = escrow.totalAmount - escrow.releasedAmount - escrow.refundedAmount;
        require(balance > 0, "No funds available");

        if (ruling == DisputeRuling.InFavorOfParticipant) {
            require(recipients.length > 0, "No recipients specified");
            require(recipients.length == amounts.length, "Arrays length mismatch");

            uint256 totalGross = 0;
            for (uint256 i = 0; i < recipients.length; i++) {
                totalGross += amounts[i];
            }
            require(totalGross <= balance, "Total exceeds balance");

            uint256 fee = totalGross * task.feeBps / 10000;
            uint256 netDistribution = totalGross - fee;

            if (netDistribution > 0) {
                _distributeProportionally(taskId, recipients, amounts, totalGross, netDistribution, escrow);
            }

            if (fee > 0) {
                _transferToTreasury(taskId, task.feeTreasury, fee, escrow);
            }

            uint256 remainder = balance - totalGross;
            if (remainder > 0) {
                _safeTransfer(task.creator, remainder);
                escrow.refundedAmount += remainder;
            }
        } else if (ruling == DisputeRuling.InFavorOfCreator) {
            _safeTransfer(task.creator, balance);
            escrow.refundedAmount += balance;
            emit TaskRefunded(taskId, balance, task.creator);
        } else if (ruling == DisputeRuling.Split) {
            require(recipients.length > 0, "No recipients specified");
            require(recipients.length == amounts.length, "Arrays length mismatch");

            uint256 totalToParticipants = 0;
            for (uint256 i = 0; i < recipients.length; i++) {
                totalToParticipants += amounts[i];
            }
            require(totalToParticipants <= balance, "Total exceeds balance");

            uint256 fee = totalToParticipants * task.feeBps / 10000;
            uint256 netPayout = totalToParticipants - fee;

            if (netPayout > 0) {
                _distributeProportionally(taskId, recipients, amounts, totalToParticipants, netPayout, escrow);
            }

            if (fee > 0) {
                _transferToTreasury(taskId, task.feeTreasury, fee, escrow);
            }

            uint256 creatorAmount = balance - totalToParticipants;
            if (creatorAmount > 0) {
                _safeTransfer(task.creator, creatorAmount);
                escrow.refundedAmount += creatorAmount;
            }
        }

        task.status = TaskStatus.Resolved;
        emit DisputeResolved(taskId, ruling, balance);
    }

    function autoResolve(uint256 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Submitted || task.status == TaskStatus.Review, "Task not in resolvable state");
        require(block.timestamp > task.reviewDeadline, "Review deadline not yet passed");
        require(!task.winnersSelected, "Winners already selected");

        if (isDisputed[taskId]) {
            revert("Task is disputed");
        }

        if (task.status == TaskStatus.Submitted) {
            task.status = TaskStatus.Review;
        }

        Escrow storage escrow = escrows[taskId];
        Submission[] storage taskSubmissions = submissions[taskId];
        uint256 subCount = task.submissionCount;

        AutoTimeoutAction action = task.timeoutAction;

        if (action == AutoTimeoutAction.Refund) {
            uint256 amount = escrow.totalAmount - escrow.refundedAmount;
            if (amount > 0) {
                _safeTransfer(task.creator, amount);
                escrow.refundedAmount += amount;
                emit TaskRefunded(taskId, amount, task.creator);
            }
            task.status = TaskStatus.Cancelled;
            emit AutoResolved(taskId, action);
            return;
        }

        require(subCount > 0, "No submissions to resolve");

        uint256 fee = task.rewardTotal * task.feeBps / 10000;
        uint256 payoutPool = task.rewardTotal - fee;

        if (action == AutoTimeoutAction.PayAll) {
            uint256 rewardPerSubmitter = payoutPool / subCount;
            for (uint256 i = 0; i < subCount; i++) {
                taskSubmissions[i].isWinner = true;
                uint256 amount = (i == subCount - 1)
                    ? payoutPool - (rewardPerSubmitter * (subCount - 1))
                    : rewardPerSubmitter;
                _safeTransfer(taskSubmissions[i].submitter, amount);
                escrow.releasedAmount += amount;
                emit RewardReleased(taskId, taskSubmissions[i].submitter, amount);
            }
        } else if (action == AutoTimeoutAction.FirstSubmission) {
            uint256 earliestIdx = 0;
            uint256 earliestTime = taskSubmissions[0].timestamp;
            for (uint256 i = 1; i < subCount; i++) {
                if (taskSubmissions[i].timestamp < earliestTime) {
                    earliestTime = taskSubmissions[i].timestamp;
                    earliestIdx = i;
                }
            }
            taskSubmissions[earliestIdx].isWinner = true;
            _safeTransfer(taskSubmissions[earliestIdx].submitter, payoutPool);
            escrow.releasedAmount += payoutPool;
            emit RewardReleased(taskId, taskSubmissions[earliestIdx].submitter, payoutPool);
        }

        if (fee > 0) {
            _transferToTreasury(taskId, task.feeTreasury, fee, escrow);
        }

        task.winnersSelected = true;
        task.status = TaskStatus.Completed;
        emit AutoResolved(taskId, action);
    }

    function setFeeBps(uint16 newFeeBps) external onlyAdmin {
        require(newFeeBps <= maxFeeBps, "Fee exceeds max");
        uint16 oldFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeBpsUpdated(oldFeeBps, newFeeBps);
    }

    function setFeeTreasury(address newTreasury) external onlyAdmin {
        require(newTreasury != address(0), "Treasury cannot be zero");
        address oldTreasury = feeTreasury;
        feeTreasury = newTreasury;
        emit FeeTreasuryUpdated(oldTreasury, newTreasury);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Admin cannot be zero");
        admin = newAdmin;
    }

    function getParticipants(uint256 taskId) external view returns (address[] memory) {
        return participants[taskId];
    }

    function getSubmissions(uint256 taskId) external view returns (Submission[] memory) {
        return submissions[taskId];
    }

    function getEscrow(uint256 taskId) external view returns (Escrow memory) {
        return escrows[taskId];
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Transfer failed");
    }

    function _transferAndEmit(uint256 taskId, address to, uint256 amount, Escrow storage escrow) private {
        _safeTransfer(to, amount);
        escrow.releasedAmount += amount;
        emit RewardReleased(taskId, to, amount);
    }

    function _transferToTreasury(uint256 taskId, address treasury, uint256 amount, Escrow storage escrow) private {
        _safeTransfer(treasury, amount);
        escrow.feeCollected += amount;
        emit PlatformFeeCollected(taskId, amount, treasury);
    }

    function _distributeMultiple(
        uint256 taskId,
        Task storage task,
        address[] memory winnerAddresses,
        uint256 winnerCount,
        uint256 payoutPool,
        Escrow storage escrow
    ) private {
        (, bool splitEqual, uint256[] memory weights) = abi.decode(task.rewardConfig, (uint256, bool, uint256[]));

        if (splitEqual) {
            uint256 rewardPerWinner = payoutPool / winnerCount;
            for (uint256 i = 0; i < winnerCount; i++) {
                uint256 amount = (i == winnerCount - 1)
                    ? payoutPool - (rewardPerWinner * (winnerCount - 1))
                    : rewardPerWinner;
                _transferAndEmit(taskId, winnerAddresses[i], amount, escrow);
            }
        } else {
            uint256 weightSum = 0;
            for (uint256 i = 0; i < winnerCount; i++) {
                weightSum += weights[i];
            }
            require(weightSum > 0, "Weight sum must be > 0");

            uint256 distributed = 0;
            for (uint256 i = 0; i < winnerCount; i++) {
                uint256 amount = payoutPool * weights[i] / weightSum;
                if (i == winnerCount - 1) {
                    amount = payoutPool - distributed;
                }
                _transferAndEmit(taskId, winnerAddresses[i], amount, escrow);
                distributed += amount;
            }
        }
    }

    function _distributeProportionally(
        uint256 taskId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 totalGross,
        uint256 netDistribution,
        Escrow storage escrow
    ) private {
        uint256 distributed = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 amount = amounts[i] * netDistribution / totalGross;
            if (i == recipients.length - 1) {
                amount = netDistribution - distributed;
            }
            _transferAndEmit(taskId, recipients[i], amount, escrow);
            distributed += amount;
        }
    }
}

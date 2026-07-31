import { http, createConfig } from "wagmi";
import { pharosTestnet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [pharosTestnet],
  transports: {
    [pharosTestnet.id]: http(),
  },
  ssr: true,
});

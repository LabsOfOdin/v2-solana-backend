const ADMIN_WALLETS = {
  DEVNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
  MAINNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
};

const SOLANA_CONFIG = {
  DEVNET: {
    RPC_URL: 'https://api.devnet.solana.com',
    PROTOCOL_WALLET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
    USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC mint
  },
  MAINNET: {
    RPC_URL: 'https://api.mainnet-beta.solana.com',
    PROTOCOL_WALLET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
    USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet USDC mint
  },
};

export const getAdminWallet = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? ADMIN_WALLETS.DEVNET : ADMIN_WALLETS.MAINNET;
};

export const getSolanaConfig = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? SOLANA_CONFIG.DEVNET : SOLANA_CONFIG.MAINNET;
};

const ADMIN_WALLETS = {
  DEVNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
  MAINNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
};

export const SOLANA_CONFIG = {
  DEVNET: {
    RPC_URL: 'https://api.devnet.solana.com',
    PROTOCOL_WALLET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
    USDC_MINT: '7ggkvgP7jijLpQBV5GXcqugTMrc2JqDi9tiCH36SVg7A', // Devnet USDC mint
  },
  MAINNET: {
    RPC_URL:
      'https://spring-snowy-telescope.solana-mainnet.quiknode.pro/734a01c9192bece76b7b324bc0c19e91cbdd8ce1',
    WS_URL:
      'wss://spring-snowy-telescope.solana-mainnet.quiknode.pro/734a01c9192bece76b7b324bc0c19e91cbdd8ce1',
    PROTOCOL_WALLET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
    USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet USDC mint
  },
};

export const LIQUIDITY_SCALAR = '0.5';
export const TRADING_FEE = '0.001'; // 0.1% trading fee
export const SECONDS_IN_DAY = '86400';

// Caps All Names
export const LISTED_DAOS = {
  DEVNET: {
    TOPKEK: 'CmqpcL5cyCHVobHYcq7dhqjrshFNVFNbQifRKMYZ2kYP',
    AI16Z: '3wY7okWt6XjGewtwCxL5eTTW8NSRgeFku5yPWMKYTbR8',
    HAIYEZ: 'FQ91m4w7jRQnZLfZJCTgC9CTVgXJZuKLcZxj7GovwKpZ',
    DRUGS: '7pPGWD9WR2HGAYfre8HjXXWtFHBsNUKKzs2vXnSQTkXY',
  },
  MAINNET: {},
};

export const getAdminWallet = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? ADMIN_WALLETS.DEVNET : ADMIN_WALLETS.MAINNET;
};

export const getSolanaConfig = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? SOLANA_CONFIG.DEVNET : SOLANA_CONFIG.MAINNET;
};

export const getListedDaos = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? LISTED_DAOS.DEVNET : LISTED_DAOS.MAINNET;
};

const ADMIN_WALLETS = {
  DEVNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
  MAINNET: '2WopEVinpz5MrjJcQppuvE2C5m14iPE5XNR8a2wsCs4C',
};

export const getAdminWallet = () => {
  const isDevnet = process.env.NODE_ENV === 'development';
  return isDevnet ? ADMIN_WALLETS.DEVNET : ADMIN_WALLETS.MAINNET;
};

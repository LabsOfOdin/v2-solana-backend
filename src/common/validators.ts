export const validatePublicKey = (publicKey: string) => {
  // Check if public key matches Solana public key format (base58 string of length 32-44)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(publicKey)) {
    throw new Error('Invalid Public Key');
  }
};

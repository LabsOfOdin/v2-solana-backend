import { Injectable } from '@nestjs/common';
import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TokenType } from '../margin/types/token.types';
import { getSolanaConfig } from '../common/config';

@Injectable()
export class SolanaService {
  private connection: Connection;
  private readonly USDC_MINT: PublicKey;
  private readonly PROTOCOL_WALLET: PublicKey;

  constructor() {
    const config = getSolanaConfig();

    this.connection = new Connection(config.RPC_URL, 'confirmed');
    this.PROTOCOL_WALLET = new PublicKey(config.PROTOCOL_WALLET);
    this.USDC_MINT = new PublicKey(config.USDC_MINT);
  }

  async verifyDeposit(
    fromAddress: string,
    txHash: string,
    expectedAmount: string,
    token: TokenType,
  ): Promise<void> {
    // 1. Get transaction details
    const tx = await this.connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      throw new Error('Transaction not found');
    }

    // 2. Verify transaction is confirmed
    if (tx.meta?.err) {
      throw new Error('Transaction failed');
    }

    // 3. Verify sender
    const senderPubkey = new PublicKey(fromAddress);

    if (
      !tx.transaction.message.accountKeys.some((key) =>
        key.pubkey.equals(senderPubkey),
      )
    ) {
      throw new Error('Transaction not from specified sender');
    }

    // 4. Verify recipient is protocol wallet
    if (
      !tx.transaction.message.accountKeys.some((key) =>
        key.pubkey.equals(this.PROTOCOL_WALLET),
      )
    ) {
      throw new Error('Transaction not sent to protocol wallet');
    }

    // 5. Verify amount and token type
    await this.verifyTokenTransfer(tx, expectedAmount, token);
  }

  private async verifyTokenTransfer(
    tx: ParsedTransactionWithMeta,
    expectedAmount: string,
    token: TokenType,
  ): Promise<void> {
    const instructions = tx.transaction.message.instructions;

    let foundTransfer = false;

    for (const ix of instructions) {
      // Handle SPL Token transfers
      if ('parsed' in ix && ix.program === 'spl-token') {
        const { type, info } = ix.parsed;

        if (type === 'transfer' || type === 'transferChecked') {
          // For USDC transfers
          if (token === TokenType.USDC) {
            if (info.mint?.equals(this.USDC_MINT)) {
              const amount = Number(info.amount) / 1e6; // USDC has 6 decimals
              if (Math.abs(amount - Number(expectedAmount)) < 1e-8) {
                foundTransfer = true;
                break;
              }
            }
          }
        }
      }
      // Handle native SOL transfers
      else if (
        'parsed' in ix &&
        ix.program === 'system' &&
        token === TokenType.SOL
      ) {
        const { type, info } = ix.parsed;
        if (type === 'transfer') {
          const amount = Number(info.lamports) / LAMPORTS_PER_SOL;
          if (Math.abs(amount - Number(expectedAmount)) < 1e-8) {
            foundTransfer = true;
            break;
          }
        }
      }
    }

    if (!foundTransfer) {
      throw new Error(
        `No matching ${token} transfer found for amount ${expectedAmount}`,
      );
    }
  }
}

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/virtual_xyk.json`.
 */
export type VirtualXyk = {
  address: '5jnapfrAN47UYkLkEf7HnprPPBCQLvkYWGZDeKkaP5hv';
  metadata: {
    name: 'virtualXyk';
    version: '3.2.0';
    spec: '0.1.0';
    description: 'Created with Anchor';
  };
  instructions: [
    {
      name: 'addLiquidity';
      discriminator: [181, 157, 89, 67, 143, 182, 52, 72];
      accounts: [
        {
          name: 'signer';
          writable: true;
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'lpMint';
          writable: true;
        },
        {
          name: 'tokenMint';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'signerLpAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'lpTokenProgram';
              },
              {
                kind: 'account';
                path: 'lpMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'signerTokenAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.token_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'signerFundingAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.funding_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.token_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.funding_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'lpTokenProgram';
          address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'fundingTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'tokenAmount';
          type: 'u64';
        },
        {
          name: 'maxFundingAmount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'buyToken';
      discriminator: [138, 127, 14, 91, 38, 87, 115, 105];
      accounts: [
        {
          name: 'signer';
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'tokenMint';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'signerTokenAta';
          writable: true;
        },
        {
          name: 'signerFundingAta';
          writable: true;
        },
        {
          name: 'tokenVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'tokenMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'fundingTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'fundingAmount';
          type: 'u64';
        },
        {
          name: 'minTokenAmount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'initLp';
      discriminator: [90, 134, 130, 76, 50, 225, 21, 142];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'lpMint';
          writable: true;
          signer: true;
        },
        {
          name: 'lpVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'lpMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'tokenProgram';
          address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'name';
          type: 'string';
        },
        {
          name: 'symbol';
          type: 'string';
        },
        {
          name: 'uri';
          type: 'string';
        },
      ];
    },
    {
      name: 'initialize';
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: 'depositor';
          writable: true;
          signer: true;
        },
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'feeAuthority';
        },
        {
          name: 'tokenMint';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'depositorTokenAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'depositor';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'tokenMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'tokenMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'depositorFundingAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'depositor';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'fundingTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'fundingAmount';
          type: 'u64';
        },
        {
          name: 'deposit';
          type: 'u64';
        },
      ];
    },
    {
      name: 'migrateV3';
      discriminator: [245, 170, 103, 124, 144, 187, 21, 102];
      accounts: [
        {
          name: 'signer';
          writable: true;
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [];
    },
    {
      name: 'redeemFees';
      discriminator: [215, 39, 180, 41, 173, 46, 248, 220];
      accounts: [
        {
          name: 'signer';
          writable: true;
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'signerFundingAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'fundingTokenProgram';
        },
      ];
      args: [
        {
          name: 'amount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'removeLiquidity';
      discriminator: [80, 85, 209, 72, 24, 206, 177, 108];
      accounts: [
        {
          name: 'signer';
          writable: true;
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'lpMint';
          writable: true;
        },
        {
          name: 'tokenMint';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'signerLpAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'lpTokenProgram';
              },
              {
                kind: 'account';
                path: 'lpMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'signerTokenAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.token_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'signerFundingAta';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'signer';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.funding_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.token_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'curve.funding_mint';
                account: 'curve';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'lpTokenProgram';
          address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'fundingTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'lpAmount';
          type: 'u64';
        },
        {
          name: 'minTokenAmount';
          type: 'u64';
        },
        {
          name: 'minFundingAmount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'sellToken';
      discriminator: [109, 61, 40, 187, 230, 176, 135, 174];
      accounts: [
        {
          name: 'signer';
          signer: true;
        },
        {
          name: 'depositor';
        },
        {
          name: 'tokenMint';
        },
        {
          name: 'fundingMint';
        },
        {
          name: 'curve';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 117, 114, 118, 101];
              },
              {
                kind: 'account';
                path: 'depositor';
              },
            ];
          };
        },
        {
          name: 'signerTokenAta';
          writable: true;
        },
        {
          name: 'signerFundingAta';
          writable: true;
        },
        {
          name: 'tokenVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'tokenMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'fundingVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'curve';
              },
              {
                kind: 'account';
                path: 'fundingTokenProgram';
              },
              {
                kind: 'account';
                path: 'fundingMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'fundingTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
      ];
      args: [
        {
          name: 'amount';
          type: 'u64';
        },
        {
          name: 'minFundingAmount';
          type: 'u64';
        },
      ];
    },
  ];
  accounts: [
    {
      name: 'curve';
      discriminator: [191, 180, 249, 66, 180, 71, 51, 182];
    },
  ];
  errors: [
    {
      code: 6000;
      name: 'invalidFeeAuthority';
      msg: 'Unauthorized fee withdrawal';
    },
    {
      code: 6001;
      name: 'invalidFeeAmount';
      msg: 'The fee amount is invalid';
    },
    {
      code: 6002;
      name: 'slippageExceeded';
      msg: 'Slippage exceeded';
    },
    {
      code: 6003;
      name: 'zeroLpToMint';
      msg: 'Invalid LP to Mint';
    },
    {
      code: 6004;
      name: 'unauthorized';
      msg: 'unauthorized';
    },
  ];
  types: [
    {
      name: 'curve';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'tokenAmount';
            type: 'u64';
          },
          {
            name: 'fundingAmount';
            type: 'u64';
          },
          {
            name: 'virtualFundingAmount';
            type: 'u64';
          },
          {
            name: 'tokenMint';
            type: 'pubkey';
          },
          {
            name: 'fundingMint';
            type: 'pubkey';
          },
          {
            name: 'totalFeeAmount';
            type: 'u64';
          },
          {
            name: 'totalFeeDistributed';
            type: 'u64';
          },
          {
            name: 'feeAuthority';
            type: 'pubkey';
          },
          {
            name: 'lpMint';
            type: {
              option: 'pubkey';
            };
          },
        ];
      };
    },
  ];
};

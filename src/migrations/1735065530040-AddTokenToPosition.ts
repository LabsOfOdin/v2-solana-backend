import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { TokenType } from '../margin/types/token.types';

export class AddTokenToPosition1735065530040 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add token column as nullable initially
    await queryRunner.addColumn(
      'positions',
      new TableColumn({
        name: 'token',
        type: 'enum',
        enum: ['SOL', 'USDC'],
        isNullable: true,
      }),
    );

    // Update existing positions based on their locked margin values
    await queryRunner.query(`
            UPDATE positions 
            SET token = (
                CASE 
                    WHEN "lockedMarginSOL" > '0' THEN 'SOL'::positions_token_enum
                    ELSE 'USDC'::positions_token_enum
                END 
            )
            WHERE token IS NULL
        `);

    // Make token column non-nullable
    await queryRunner.changeColumn(
      'positions',
      'token',
      new TableColumn({
        name: 'token',
        type: 'enum',
        enum: ['SOL', 'USDC'],
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('positions', 'token');
  }
}

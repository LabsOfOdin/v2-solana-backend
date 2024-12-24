import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePositionEntity1703445600000 implements MigrationInterface {
  name = 'UpdatePositionEntity1703445600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add symbol column as nullable first
    await queryRunner.query(
      `ALTER TABLE "positions" ADD "symbol" character varying(20)`,
    );

    // Update existing positions with symbol from their associated market
    await queryRunner.query(`
      UPDATE "positions" p
      SET "symbol" = m.symbol
      FROM "markets" m
      WHERE p."marketId" = m.id
    `);

    // Make symbol column not nullable
    await queryRunner.query(
      `ALTER TABLE "positions" ALTER COLUMN "symbol" SET NOT NULL`,
    );

    // Drop columns that are no longer needed
    await queryRunner.query(`ALTER TABLE "positions" DROP COLUMN "marginType"`);
    await queryRunner.query(
      `ALTER TABLE "positions" DROP COLUMN "highestPrice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" DROP COLUMN "lowestPrice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" DROP COLUMN "unrealizedPnl"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert the changes in case of rollback
    await queryRunner.query(`ALTER TABLE "positions" DROP COLUMN "symbol"`);

    // Recreate dropped columns
    await queryRunner.query(
      `ALTER TABLE "positions" ADD "marginType" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD "highestPrice" decimal(40,18)`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD "lowestPrice" decimal(40,18)`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD "unrealizedPnl" decimal(40,18) NOT NULL`,
    );
  }
}

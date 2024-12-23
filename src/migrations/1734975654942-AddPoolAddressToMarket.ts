import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPoolAddressToMarket1734975654942 implements MigrationInterface {
  name = 'AddPoolAddressToMarket1734975654942';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First add the column as nullable
    await queryRunner.query(
      `ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "poolAddress" character varying`,
    );

    // Update existing records with a temporary value
    await queryRunner.query(
      `UPDATE "markets" SET "poolAddress" = "tokenAddress" WHERE "poolAddress" IS NULL`,
    );

    // Make the column NOT NULL
    await queryRunner.query(
      `ALTER TABLE "markets" ALTER COLUMN "poolAddress" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN IF EXISTS "poolAddress"`,
    );
  }
}

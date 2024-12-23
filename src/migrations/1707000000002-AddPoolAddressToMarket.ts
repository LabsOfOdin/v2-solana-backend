import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPoolAddressToMarket1707000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First add the column as nullable
    await queryRunner.query(
      `ALTER TABLE "markets" ADD COLUMN "poolAddress" character varying`,
    );

    // Update existing records with a temporary value
    // You may want to replace 'DEFAULT_POOL_ADDRESS' with an appropriate default value
    await queryRunner.query(
      `UPDATE "markets" SET "poolAddress" = 'DEFAULT_POOL_ADDRESS' WHERE "poolAddress" IS NULL`,
    );

    // Make the column NOT NULL
    await queryRunner.query(
      `ALTER TABLE "markets" ALTER COLUMN "poolAddress" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "markets" DROP COLUMN "poolAddress"`);
  }
}

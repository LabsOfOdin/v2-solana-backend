import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateMarketEntity1707000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new tokenAddress column
    await queryRunner.query(`
      ALTER TABLE "markets"
      ADD COLUMN "tokenAddress" character varying NOT NULL DEFAULT '';
    `);

    // Remove unnecessary columns
    await queryRunner.query(`
      ALTER TABLE "markets"
      DROP COLUMN "baseAsset",
      DROP COLUMN "quoteAsset",
      DROP COLUMN "minOrderSize",
      DROP COLUMN "pythPriceAccountKey",
      DROP COLUMN "allowIsolated",
      DROP COLUMN "allowCross";
    `);

    // Create position status enum if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."position_status_enum" AS ENUM ('OPEN', 'CLOSED', 'LIQUIDATED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add status column to positions if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "positions" ADD COLUMN "status" "public"."position_status_enum" DEFAULT 'OPEN';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Update positions to include status
    await queryRunner.query(`
      UPDATE "positions"
      SET "status" = 'OPEN'
      WHERE "status" IS NULL;
    `);

    // Make status column not nullable
    await queryRunner.query(`
      ALTER TABLE "positions"
      ALTER COLUMN "status" SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add back removed columns
    await queryRunner.query(`
      ALTER TABLE "markets"
      ADD COLUMN "baseAsset" character varying,
      ADD COLUMN "quoteAsset" character varying,
      ADD COLUMN "minOrderSize" decimal(40,20),
      ADD COLUMN "pythPriceAccountKey" character varying,
      ADD COLUMN "allowIsolated" boolean DEFAULT true,
      ADD COLUMN "allowCross" boolean DEFAULT true;
    `);

    // Remove new tokenAddress column
    await queryRunner.query(`
      ALTER TABLE "markets"
      DROP COLUMN "tokenAddress";
    `);

    // Remove status column from positions
    await queryRunner.query(`
      ALTER TABLE "positions"
      DROP COLUMN "status";
    `);

    // Drop position status enum
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."position_status_enum";
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFundingFieldsToMarket1735485554325
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add maxFundingRate with default 0.0003 (0.03%)
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "maxFundingRate" decimal(40,20) NOT NULL DEFAULT 0.0003`,
    );

    // Add maxFundingVelocity with default 0.01 (1%)
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "maxFundingVelocity" decimal(40,20) NOT NULL DEFAULT 0.01`,
    );

    // Add fundingRateVelocity with default 0
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "fundingRateVelocity" decimal(40,20) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "fundingRateVelocity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "maxFundingVelocity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "maxFundingRate"`,
    );
  }
}

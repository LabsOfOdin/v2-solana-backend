import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeeTrackingToMarket1735485554326 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "cumulativeFees" decimal(40,20) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "unclaimedFees" decimal(40,20) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "unclaimedFees"`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "cumulativeFees"`,
    );
  }
}

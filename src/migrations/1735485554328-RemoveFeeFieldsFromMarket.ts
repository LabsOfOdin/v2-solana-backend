import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveFeeFieldsFromMarket1735485554328
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "markets" DROP COLUMN "makerFee"`);
    await queryRunner.query(`ALTER TABLE "markets" DROP COLUMN "takerFee"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "makerFee" decimal(40,20) NOT NULL DEFAULT '0.001'`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "takerFee" decimal(40,20) NOT NULL DEFAULT '0.001'`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpactPoolToMarket1735485554324 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" ADD "impactPool" decimal(40,20) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "markets" DROP COLUMN "impactPool"`);
  }
}

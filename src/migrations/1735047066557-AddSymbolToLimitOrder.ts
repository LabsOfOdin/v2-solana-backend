import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSymbolToLimitOrder1735047066557 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "limit_orders" ADD COLUMN "symbol" varchar(255) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "limit_orders" DROP COLUMN "symbol"`);
  }
}

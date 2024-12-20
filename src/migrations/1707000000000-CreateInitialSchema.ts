import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1707000000000 implements MigrationInterface {
  name = 'CreateInitialSchema1707000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "publicKey" varchar UNIQUE NOT NULL,
        "availableBalance" decimal(40,20) NOT NULL DEFAULT '0',
        "totalBalance" decimal(40,20) NOT NULL DEFAULT '0',
        "lockedMargin" decimal(40,20) NOT NULL DEFAULT '0',
        "unrealizedPnl" decimal(40,20) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Markets table
    await queryRunner.query(`
      CREATE TYPE "public"."market_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'CLOSED')
    `);

    await queryRunner.query(`
      CREATE TABLE "markets" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "symbol" varchar UNIQUE NOT NULL,
        "baseAsset" varchar NOT NULL,
        "quoteAsset" varchar NOT NULL,
        "minOrderSize" decimal(40,20) NOT NULL,
        "maxLeverage" decimal(40,20) NOT NULL,
        "maintainanceMargin" decimal(40,20) NOT NULL,
        "takerFee" decimal(40,20) NOT NULL,
        "makerFee" decimal(40,20) NOT NULL,
        "status" "public"."market_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "fundingRate" decimal(40,20) NOT NULL,
        "pythPriceAccountKey" varchar NOT NULL,
        "allowIsolated" boolean NOT NULL DEFAULT true,
        "allowCross" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Create enum for order side and margin type
    await queryRunner.query(`
      CREATE TYPE "public"."order_side_enum" AS ENUM('LONG', 'SHORT')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."margin_type_enum" AS ENUM('ISOLATED', 'CROSS')
    `);

    // Positions table
    await queryRunner.query(`
      CREATE TABLE "positions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "marketId" uuid NOT NULL REFERENCES "markets"("id"),
        "side" "public"."order_side_enum" NOT NULL,
        "size" decimal(40,20) NOT NULL,
        "entryPrice" decimal(40,20) NOT NULL,
        "leverage" decimal(40,20) NOT NULL,
        "marginType" "public"."margin_type_enum" NOT NULL,
        "liquidationPrice" decimal(40,20) NOT NULL,
        "unrealizedPnl" decimal(40,20) NOT NULL,
        "margin" decimal(40,20) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Trades table
    await queryRunner.query(`
      CREATE TABLE "trades" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "positionId" uuid NOT NULL REFERENCES "positions"("id"),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "marketId" uuid NOT NULL REFERENCES "markets"("id"),
        "side" "public"."order_side_enum" NOT NULL,
        "size" decimal(40,20) NOT NULL,
        "price" decimal(40,20) NOT NULL,
        "leverage" decimal(40,20) NOT NULL,
        "marginType" "public"."margin_type_enum" NOT NULL,
        "realizedPnl" decimal(40,20),
        "fee" decimal(40,20) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Liquidity pools table
    await queryRunner.query(`
      CREATE TABLE "liquidity_pools" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "totalLiquidity" decimal(40,20) NOT NULL DEFAULT '0',
        "availableLiquidity" decimal(40,20) NOT NULL DEFAULT '0',
        "utilizationRate" decimal(40,20) NOT NULL DEFAULT '0',
        "maxUtilizationRate" decimal(40,20) NOT NULL DEFAULT '0.8',
        "lpTokenSupply" decimal(40,20) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // LP positions table
    await queryRunner.query(`
      CREATE TABLE "lp_positions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "lpTokens" decimal(40,20) NOT NULL,
        "sharePercentage" decimal(40,20) NOT NULL,
        "depositedAmount" decimal(40,20) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Margin locks table
    await queryRunner.query(`
      CREATE TABLE "margin_locks" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "positionId" uuid NOT NULL REFERENCES "positions"("id"),
        "amount" decimal(40,20) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "margin_locks"`);
    await queryRunner.query(`DROP TABLE "lp_positions"`);
    await queryRunner.query(`DROP TABLE "liquidity_pools"`);
    await queryRunner.query(`DROP TABLE "trades"`);
    await queryRunner.query(`DROP TABLE "positions"`);
    await queryRunner.query(`DROP TABLE "markets"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."market_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."order_side_enum"`);
    await queryRunner.query(`DROP TYPE "public"."margin_type_enum"`);
  }
}

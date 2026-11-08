-- CreateTable
CREATE TABLE "DollarSale" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "usdAmount" DECIMAL(14,2) NOT NULL,
    "bdtAmount" DECIMAL(14,2) NOT NULL,
    "costRate" DECIMAL(10,4) NOT NULL,
    "effectiveRate" DECIMAL(10,4) NOT NULL,
    "costBdt" DECIMAL(14,2) NOT NULL,
    "profit" DECIMAL(14,2) NOT NULL,
    "marginPct" DECIMAL(8,2) NOT NULL,
    "date" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "bankAccountId" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DollarSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DollarSale_reference_key" ON "DollarSale"("reference");

-- CreateIndex
CREATE INDEX "DollarSale_clientId_idx" ON "DollarSale"("clientId");

-- CreateIndex
CREATE INDEX "DollarSale_date_idx" ON "DollarSale"("date");

-- AddForeignKey
ALTER TABLE "DollarSale" ADD CONSTRAINT "DollarSale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

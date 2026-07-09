-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_records" INTEGER NOT NULL,
    "processed_records" INTEGER NOT NULL DEFAULT 0,
    "skipped_records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "email" TEXT,
    "country_code" TEXT,
    "mobile_without_country_code" TEXT,
    "company" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "lead_owner" TEXT,
    "crm_status" TEXT,
    "crm_note" TEXT,
    "data_source" TEXT,
    "possession_time" TEXT,
    "description" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_created_at_idx" ON "import_runs"("created_at");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_mobile_without_country_code_idx" ON "leads"("mobile_without_country_code");

-- CreateIndex
CREATE INDEX "leads_import_id_crm_status_idx" ON "leads"("import_id", "crm_status");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "BrandingConfig" ADD COLUMN     "logoDarkJxlUrl" TEXT,
ADD COLUMN     "logoJxlUrl" TEXT,
ADD COLUMN     "logoLightJxlUrl" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "logoJxlUrl" TEXT,
ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "photoJxlUrl" TEXT,
ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "logoJxlUrl" TEXT,
ADD COLUMN     "logoUrl" TEXT;

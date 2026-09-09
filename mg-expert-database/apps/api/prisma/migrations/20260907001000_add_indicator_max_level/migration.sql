ALTER TABLE "IndicatorSystem" ADD COLUMN "maxLevel" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "IndicatorSystem"
ADD CONSTRAINT "IndicatorSystem_maxLevel_check"
CHECK ("maxLevel" BETWEEN 1 AND 6);

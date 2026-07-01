-- Change date_posted from DATE to TIMESTAMPTZ to store time component
ALTER TABLE job_evaluations ALTER COLUMN date_posted TYPE TIMESTAMPTZ USING date_posted::TIMESTAMPTZ;

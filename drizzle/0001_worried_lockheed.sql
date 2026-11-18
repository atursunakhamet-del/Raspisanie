CREATE TABLE `data_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_json` text NOT NULL,
	`backup_revision` integer NOT NULL,
	`applied_at` integer NOT NULL
);

CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_snoozes` (
	`item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`until` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_snoozes_user` ON `item_snoozes` (`user_id`);--> statement-breakpoint
CREATE TABLE `item_surfaced` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`surfaced_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`period_key` text NOT NULL,
	`item_ids` text DEFAULT '[]' NOT NULL,
	`sent_at` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_once` ON `notification_log` (`user_id`,`kind`,`period_key`,`channel`);--> statement-breakpoint
CREATE INDEX `notification_log_user_sent` ON `notification_log` (`user_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`push_enabled` integer DEFAULT false NOT NULL,
	`digest_frequency` text DEFAULT 'off' NOT NULL,
	`digest_day_of_week` integer DEFAULT 0 NOT NULL,
	`digest_day_of_month` integer DEFAULT 1 NOT NULL,
	`digest_hour` integer DEFAULT 9 NOT NULL,
	`digest_items_per_category` integer DEFAULT 3 NOT NULL,
	`digest_category_ids` text,
	`resurface_enabled` integer DEFAULT false NOT NULL,
	`resurface_after_months` integer DEFAULT 6 NOT NULL,
	`quiet_start` integer,
	`quiet_end` integer,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`daily_cap` integer DEFAULT 3 NOT NULL,
	`schedule_changed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`keys` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_success_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subs_user` ON `push_subscriptions` (`user_id`);
CREATE TABLE `activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(60) NOT NULL,
	`category_id` int NOT NULL,
	`image_key` varchar(255),
	`default_price` int NOT NULL,
	`default_capacity` tinyint NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `activities_name_unique` UNIQUE(`name`),
	CONSTRAINT `activity_capacity` CHECK(`activities`.`default_capacity` BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int NOT NULL,
	`action` varchar(40) NOT NULL,
	`entity` varchar(30) NOT NULL,
	`entity_id` int NOT NULL,
	`data` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ref` varchar(12) NOT NULL,
	`slot_id` int NOT NULL,
	`user_id` int NOT NULL,
	`seats` tinyint NOT NULL,
	`amount` int NOT NULL,
	`status` enum('pending','confirmed','checked_in','cancelled','no_show','expired') NOT NULL,
	`method` enum('upi','venue','gateway') NOT NULL DEFAULT 'upi',
	`hold_until` datetime,
	`idempotency_key` varchar(64) NOT NULL,
	`active_user_id` int GENERATED ALWAYS AS (IF(status IN ('pending','confirmed','checked_in'), user_id, NULL)) STORED,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_ref_unique` UNIQUE(`ref`),
	CONSTRAINT `bookings_idempotency_key_unique` UNIQUE(`idempotency_key`),
	CONSTRAINT `one_active_booking_per_slot` UNIQUE(`slot_id`,`active_user_id`),
	CONSTRAINT `booking_seats` CHECK(`bookings`.`seats` BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(30) NOT NULL,
	`emoji` varchar(8) NOT NULL,
	`sort` tinyint NOT NULL DEFAULT 0,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournament_id` int NOT NULL,
	`round` tinyint NOT NULL,
	`position` tinyint NOT NULL,
	`player1_id` int,
	`player2_id` int,
	`winner_id` int,
	CONSTRAINT `matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_slot` UNIQUE(`tournament_id`,`round`,`position`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int,
	`tournament_player_id` int,
	`method` enum('upi','venue','gateway') NOT NULL,
	`amount` int NOT NULL,
	`utr` varchar(22),
	`gateway_order_id` varchar(40),
	`gateway_payment_id` varchar(40),
	`status` enum('pending','verified','rejected') NOT NULL,
	`verified_by` int,
	`verified_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_utr_unique` UNIQUE(`utr`),
	CONSTRAINT `payments_gateway_order_id_unique` UNIQUE(`gateway_order_id`),
	CONSTRAINT `payments_gateway_payment_id_unique` UNIQUE(`gateway_payment_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `sessions_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`activity_id` int NOT NULL,
	`zone_id` int NOT NULL,
	`starts_at` datetime NOT NULL,
	`ends_at` datetime NOT NULL,
	`price` int NOT NULL,
	`capacity` tinyint NOT NULL,
	`booked_seats` tinyint NOT NULL DEFAULT 0,
	`host_name` varchar(60),
	`cancelled` boolean NOT NULL DEFAULT false,
	CONSTRAINT `slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `slot_capacity` CHECK(`slots`.`capacity` BETWEEN 1 AND 30 AND `slots`.`booked_seats` BETWEEN 0 AND `slots`.`capacity`),
	CONSTRAINT `slot_times` CHECK(`slots`.`ends_at` > `slots`.`starts_at`),
	CONSTRAINT `slot_price` CHECK(`slots`.`price` >= 0)
);
--> statement-breakpoint
CREATE TABLE `tournament_players` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournament_id` int NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tournament_players_id` PRIMARY KEY(`id`),
	CONSTRAINT `one_entry_per_user` UNIQUE(`tournament_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(80) NOT NULL,
	`activity_id` int NOT NULL,
	`starts_at` datetime NOT NULL,
	`entry_fee` int NOT NULL DEFAULT 0,
	`max_players` tinyint NOT NULL,
	`banner_key` varchar(255),
	`status` enum('draft','open','closed','live','finished') NOT NULL DEFAULT 'draft',
	CONSTRAINT `tournaments_id` PRIMARY KEY(`id`),
	CONSTRAINT `tournament_players` CHECK(`tournaments`.`max_players` BETWEEN 2 AND 30)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`google_sub` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`phone` varchar(15),
	`avatar_key` varchar(255),
	`role` enum('member','desk','manager','owner') NOT NULL DEFAULT 'member',
	`blocked` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_google_sub_unique` UNIQUE(`google_sub`)
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	CONSTRAINT `zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `zones_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_slot_id_slots_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_tournament_id_tournaments_id_fk` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_player1_id_tournament_players_id_fk` FOREIGN KEY (`player1_id`) REFERENCES `tournament_players`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_player2_id_tournament_players_id_fk` FOREIGN KEY (`player2_id`) REFERENCES `tournament_players`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_winner_id_tournament_players_id_fk` FOREIGN KEY (`winner_id`) REFERENCES `tournament_players`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `slots` ADD CONSTRAINT `slots_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `slots` ADD CONSTRAINT `slots_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournament_players` ADD CONSTRAINT `tournament_players_tournament_id_tournaments_id_fk` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournament_players` ADD CONSTRAINT `tournament_players_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tournaments` ADD CONSTRAINT `tournaments_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `bookings_user` ON `bookings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bookings_hold` ON `bookings` (`status`,`hold_until`);--> statement-breakpoint
CREATE INDEX `payments_status` ON `payments` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `slots_zone_time` ON `slots` (`zone_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `slots_time` ON `slots` (`starts_at`);
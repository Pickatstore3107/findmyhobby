CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'checked_in', 'cancelled', 'no_show', 'expired');--> statement-breakpoint
CREATE TYPE "public"."pay_method" AS ENUM('upi', 'venue', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'desk', 'manager', 'owner');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('draft', 'open', 'closed', 'live', 'finished');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(60) NOT NULL,
	"category_id" integer NOT NULL,
	"image_key" varchar(255),
	"default_price" integer NOT NULL,
	"default_capacity" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "activities_name_unique" UNIQUE("name"),
	CONSTRAINT "activity_capacity" CHECK ("activities"."default_capacity" BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"entity" varchar(30) NOT NULL,
	"entity_id" integer NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref" varchar(12) NOT NULL,
	"slot_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"seats" smallint NOT NULL,
	"amount" integer NOT NULL,
	"status" "booking_status" NOT NULL,
	"method" "pay_method" DEFAULT 'upi' NOT NULL,
	"hold_until" timestamp with time zone,
	"idempotency_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_ref_unique" UNIQUE("ref"),
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "booking_seats" CHECK ("bookings"."seats" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(30) NOT NULL,
	"emoji" varchar(8) NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tournament_id" integer NOT NULL,
	"round" smallint NOT NULL,
	"position" smallint NOT NULL,
	"player1_id" integer,
	"player2_id" integer,
	"winner_id" integer
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"booking_id" integer,
	"tournament_player_id" integer,
	"method" "pay_method" NOT NULL,
	"amount" integer NOT NULL,
	"utr" varchar(22),
	"gateway_order_id" varchar(40),
	"gateway_payment_id" varchar(40),
	"status" "payment_status" NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_utr_unique" UNIQUE("utr"),
	CONSTRAINT "payments_gateway_order_id_unique" UNIQUE("gateway_order_id"),
	CONSTRAINT "payments_gateway_payment_id_unique" UNIQUE("gateway_payment_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"activity_id" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price" integer NOT NULL,
	"capacity" smallint NOT NULL,
	"booked_seats" smallint DEFAULT 0 NOT NULL,
	"host_name" varchar(60),
	"cancelled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "slot_capacity" CHECK ("slots"."capacity" BETWEEN 1 AND 30 AND "slots"."booked_seats" BETWEEN 0 AND "slots"."capacity"),
	CONSTRAINT "slot_times" CHECK ("slots"."ends_at" > "slots"."starts_at"),
	CONSTRAINT "slot_price" CHECK ("slots"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_players" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_players_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tournament_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournaments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(80) NOT NULL,
	"activity_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"entry_fee" integer DEFAULT 0 NOT NULL,
	"max_players" smallint NOT NULL,
	"banner_key" varchar(255),
	"status" "tournament_status" DEFAULT 'draft' NOT NULL,
	CONSTRAINT "tournament_players" CHECK ("tournaments"."max_players" BETWEEN 2 AND 30)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"google_sub" varchar(64) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(15),
	"avatar_key" varchar(255),
	"role" "role" DEFAULT 'member' NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(50) NOT NULL,
	CONSTRAINT "zones_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_player1_id_tournament_players_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."tournament_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_player2_id_tournament_players_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."tournament_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_tournament_players_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."tournament_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_booking_per_slot" ON "bookings" USING btree ("slot_id","user_id") WHERE "bookings"."status" IN ('pending', 'confirmed', 'checked_in');--> statement-breakpoint
CREATE INDEX "bookings_user" ON "bookings" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_hold" ON "bookings" USING btree ("status","hold_until");--> statement-breakpoint
CREATE UNIQUE INDEX "match_slot" ON "matches" USING btree ("tournament_id","round","position");--> statement-breakpoint
CREATE INDEX "payments_status" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slots_zone_time" ON "slots" USING btree ("zone_id","starts_at");--> statement-breakpoint
CREATE INDEX "slots_time" ON "slots" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_entry_per_user" ON "tournament_players" USING btree ("tournament_id","user_id");
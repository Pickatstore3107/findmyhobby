CREATE TABLE "hosts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hosts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(60) NOT NULL,
	"bio" varchar(300),
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hosts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"points" integer NOT NULL,
	"reason" varchar(30) NOT NULL,
	"note" varchar(120),
	"booking_id" integer,
	"tournament_id" integer,
	"awarded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Centre #1: the whole space runs one session at a time, so zones go away.
ALTER TABLE "slots" DROP CONSTRAINT "slots_zone_id_zones_id_fk";--> statement-breakpoint
DROP INDEX "slots_zone_time";--> statement-breakpoint
DROP TABLE "zones";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "default_capacity" SET DEFAULT 20;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "bring" varchar(200);--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "level" varchar(20) DEFAULT 'All levels' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "duration_min" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "default_host_id" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "color" varchar(7) DEFAULT '#EDEAE5' NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "host_id" integer;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_user" ON "points" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "points_time" ON "points" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_award_per_booking" ON "points" USING btree ("booking_id","reason") WHERE "points"."booking_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_default_host_id_hosts_id_fk" FOREIGN KEY ("default_host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" DROP COLUMN "zone_id";--> statement-breakpoint
ALTER TABLE "slots" DROP COLUMN "host_name";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_duration" CHECK ("activities"."duration_min" BETWEEN 15 AND 720);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "category_color" CHECK ("categories"."color" ~ '^#[0-9A-Fa-f]{6}$');--> statement-breakpoint
-- Like every other table: only our server (the owner) reads and writes; Supabase's public API sees nothing.
ALTER TABLE "hosts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The four categories members browse, with their card colours.
INSERT INTO "categories" ("name", "emoji", "color", "sort") VALUES
  ('Play', '♟️', '#FFD45C', 1), ('Move', '🧘', '#9CCBFF', 2), ('Create', '🎨', '#F7B8DD', 3), ('Learn', '💡', '#BDEB9A', 4)
ON CONFLICT ("name") DO UPDATE SET "color" = EXCLUDED."color", "sort" = EXCLUDED."sort";
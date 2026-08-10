CREATE TABLE "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"send_id" text,
	"member_id" text,
	"type" text NOT NULL,
	"provider" text,
	"provider_event_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"send_id" text NOT NULL,
	"member_id" text,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"unsubscribe_token" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"newsletter_id" text NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"subscribed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"newsletter_id" text NOT NULL,
	"subject" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"reply_to" text,
	"audience" jsonb NOT NULL,
	"created_by" text,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_recipients" integer DEFAULT 0 NOT NULL,
	"failed_recipients" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletters" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"reply_to" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "newsletters_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_recipient_id_email_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_send_id_newsletter_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."newsletter_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_send_id_newsletter_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."newsletter_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_preferences" ADD CONSTRAINT "newsletter_preferences_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_preferences" ADD CONSTRAINT "newsletter_preferences_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_events_recipient_idx" ON "email_events" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "email_events_send_idx" ON "email_events" USING btree ("send_id");--> statement-breakpoint
CREATE INDEX "email_recipients_send_idx" ON "email_recipients" USING btree ("send_id");--> statement-breakpoint
CREATE INDEX "email_recipients_status_idx" ON "email_recipients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipients_member_send_idx" ON "email_recipients" USING btree ("member_id","send_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_reason_idx" ON "email_suppressions" USING btree ("email","reason");--> statement-breakpoint
CREATE INDEX "email_suppressions_email_idx" ON "email_suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_prefs_member_newsletter_idx" ON "newsletter_preferences" USING btree ("member_id","newsletter_id");--> statement-breakpoint
CREATE INDEX "newsletter_prefs_member_idx" ON "newsletter_preferences" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "newsletter_sends_status_idx" ON "newsletter_sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX "newsletter_sends_scheduled_at_idx" ON "newsletter_sends" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "newsletter_sends_newsletter_idx" ON "newsletter_sends" USING btree ("newsletter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_provider_event_idx" ON "provider_events" USING btree ("provider","provider_event_id");
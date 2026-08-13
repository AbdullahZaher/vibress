ALTER TABLE "analytics_events" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "visitor_hash" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "referrer_domain" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_occurred_idx" ON "analytics_events" USING btree ("visitor_hash","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_path_occurred_idx" ON "analytics_events" USING btree ("path","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_referrer_occurred_idx" ON "analytics_events" USING btree ("referrer_domain","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_name_occurred_idx" ON "analytics_events" USING btree ("event_name","occurred_at");
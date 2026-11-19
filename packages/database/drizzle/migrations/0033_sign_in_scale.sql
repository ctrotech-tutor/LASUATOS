ALTER TABLE "student_face_profiles" ADD COLUMN "centroid_packed" "bytea";--> statement-breakpoint
CREATE INDEX "student_profiles_matric_key_idx" ON "student_profiles" USING btree ("institution_id",upper(replace("student_number", ' ', '')));--> statement-breakpoint
-- Pack the centroids already registered (float4send is big-endian, as the API writes them).
UPDATE "student_face_profiles" SET "centroid_packed" = (
  SELECT string_agg(float4send(element.value::float4), ''::bytea ORDER BY element.position)
  FROM jsonb_array_elements_text("student_face_profiles"."centroid") WITH ORDINALITY AS element(value, position)
) WHERE "centroid_packed" IS NULL AND jsonb_typeof("centroid") = 'array';

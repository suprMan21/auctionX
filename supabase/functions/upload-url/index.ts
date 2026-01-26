import { createClient } from 'jsr:@supabase/supabase-js@2'
import { S3Service } from "../_shared/s3.ts";

const s3 = new S3Service({
  region: Deno.env.get("AWS_REGION")!,
  accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
  secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  bucket: Deno.env.get("AWS_S3_BUCKET")!,
});

interface UploadRequest {
  type: "profile" | "listing" | "verification";
  userId: string;
  filename: string;
  contentType: string;
  listingId?: string;
  verificationType?: "id-front" | "id-back" | "video";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", details: authError?.message }), 
        { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const body: UploadRequest = await req.json();

    const allowedTypes = /^(image\/(jpeg|png|webp|gif)|video\/mp4)$/;
    if (!allowedTypes.test(body.contentType)) {
      return new Response(
        JSON.stringify({ error: "INVALID_CONTENT_TYPE" }), 
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    let s3Key: string;
    switch (body.type) {
      case "profile":
        s3Key = s3.generateProfilePhotoKey(body.userId, body.filename);
        break;
      case "listing":
        if (!body.listingId) {
          return new Response(
            JSON.stringify({ error: "LISTING_ID_REQUIRED" }), 
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }
        s3Key = s3.generateListingMediaKey(body.listingId, body.filename);
        break;
      case "verification":
        if (!body.verificationType) {
          return new Response(
            JSON.stringify({ error: "VERIFICATION_TYPE_REQUIRED" }), 
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }
        s3Key = s3.generateVerificationKey(body.userId, body.verificationType);
        break;
      default:
        return new Response(
          JSON.stringify({ error: "INVALID_UPLOAD_TYPE" }), 
          { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
    }

    const result = await s3.generateUploadUrl({
      key: s3Key,
      contentType: body.contentType,
      expiresIn: 300,
    });

    return new Response(
      JSON.stringify(result), 
      { 
        status: 200, 
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        } 
      }
    );

  } catch (error) {
    console.error("Upload URL generation error:", error);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", details: error.message }), 
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});

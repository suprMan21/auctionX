import * as dotenv from "dotenv";
import { generateUploadUrl, getPublicUrl, generateListingMediaKey } from "./v1/lib/s3";

dotenv.config({ path: ".env.local" });

async function testS3() {
  console.log("Testing S3 configuration...");
  console.log("Bucket:", process.env.AWS_S3_BUCKET);
  console.log("Region:", process.env.AWS_REGION);
  
  try {
    const key = generateListingMediaKey("test-listing", "test.jpg");
    console.log("Generated key:", key);
    
    const uploadUrl = await generateUploadUrl({
      key,
      contentType: "image/jpeg",
    });
    console.log("Presigned URL generated successfully!");
    console.log("URL length:", uploadUrl.length);
    
    const publicUrl = getPublicUrl(key);
    console.log("Public URL:", publicUrl);
    
    console.log("\n✅ S3 connection test passed!");
  } catch (error) {
    console.error("❌ S3 test failed:", error);
  }
}

testS3();

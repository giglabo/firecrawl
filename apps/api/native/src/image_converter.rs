use napi::bindgen_prelude::*;
use napi::Status;
use napi_derive::napi;

#[napi]
pub fn convert_image_to_webp(input: Buffer, quality: u32) -> Result<Buffer> {
    let data: &[u8] = &input;

    let img = image::load_from_memory(data)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to decode image: {e}")))?;

    let encoder = webp::Encoder::from_image(&img)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create WebP encoder: {e}")))?;

    let encoded = encoder.encode(quality as f32);

    Ok(encoded.to_vec().into())
}

//! 智能体工具窗口的后端：调用 OpenAI 兼容的 /chat/completions 接口
//! （OpenAI / DeepSeek / Kimi / 通义 / 本地 Ollama 等均可）。

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Serialize, Deserialize, Clone)]
pub struct AiMessage {
    pub role: String,
    /// 字符串，或 OpenAI 视觉格式的分段数组（text / image_url）。
    pub content: serde_json::Value,
}

/// Read a local image file and return it as a base64 data URL (vision API input).
#[command]
pub fn ai_image_data_url(path: String) -> Result<String, String> {
    use base64::Engine as _;
    let ext = path
        .rsplit('.')
        .next()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return Err("仅支持 png / jpg / jpeg / gif / webp / bmp 图片".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("图片超过 8MB，请压缩后再附加".into());
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Non-streaming chat completion against an OpenAI-compatible endpoint.
#[command]
pub async fn ai_chat(
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<AiMessage>,
) -> Result<String, String> {
    if endpoint.trim().is_empty() {
        return Err("API 地址未配置（设置 › 智能体）".into());
    }
    if messages.is_empty() {
        return Err("没有要发送的消息".into());
    }
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;
    let body = serde_json::json!({
        "model": if model.trim().is_empty() { "gpt-4o-mini".to_string() } else { model.trim().to_string() },
        "messages": messages,
        "stream": false,
    });
    let resp = client
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        let head: String = text.chars().take(400).collect();
        return Err(format!("HTTP {status}: {head}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("响应解析失败: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| {
            format!(
                "响应格式异常：{}",
                &text.chars().take(200).collect::<String>()
            )
        })?;
    Ok(content.to_string())
}

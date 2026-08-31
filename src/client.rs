use std::net::IpAddr;
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Url;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};

use crate::model::{ApplyOutcome, BoardSnapshot, HaspEvent};

#[derive(Debug, Clone)]
pub struct HaspClient {
    endpoint: String,
    token: String,
    http: reqwest::Client,
}

impl HaspClient {
    pub fn new(endpoint: impl Into<String>, token: impl Into<String>) -> Result<Self> {
        let endpoint = validate_endpoint(&endpoint.into())?;
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(100))
            .timeout(Duration::from_millis(200))
            .build()?;
        Ok(Self {
            endpoint,
            token: token.into(),
            http,
        })
    }

    pub async fn ingest(&self, event: &HaspEvent) -> Result<ApplyOutcome> {
        let response = self
            .http
            .post(format!("{}/v1/events", self.endpoint))
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(CONTENT_TYPE, "application/json")
            .json(event)
            .send()
            .await
            .context("HASP listener unavailable")?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    pub async fn snapshot(&self) -> Result<BoardSnapshot> {
        let response = self
            .http
            .get(format!("{}/v1/state", self.endpoint))
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .send()
            .await
            .context("HASP listener unavailable")?
            .error_for_status()?;
        Ok(response.json().await?)
    }
}

fn validate_endpoint(endpoint: &str) -> Result<String> {
    let url = Url::parse(endpoint).context("HASP endpoint must be a valid URL")?;
    let host = url.host_str().unwrap_or_default();
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    anyhow::ensure!(
        url.scheme() == "http" && is_loopback,
        "HASP endpoint must use HTTP on localhost or a loopback IP"
    );
    anyhow::ensure!(
        url.username().is_empty() && url.password().is_none(),
        "HASP endpoint must not contain user information"
    );
    anyhow::ensure!(
        matches!(url.path(), "" | "/") && url.query().is_none() && url.fragment().is_none(),
        "HASP endpoint must not contain a path, query, or fragment"
    );
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::HaspClient;

    #[test]
    fn accepts_only_loopback_endpoints() -> anyhow::Result<()> {
        HaspClient::new("http://127.0.0.1:43187", "token")?;
        HaspClient::new("http://[::1]:43187", "token")?;
        HaspClient::new("http://localhost:43187/", "token")?;
        assert!(HaspClient::new("https://example.com", "token").is_err());
        assert!(HaspClient::new("http://10.0.0.2:43187", "token").is_err());
        assert!(HaspClient::new("http://127.0.0.1:43187/proxy", "token").is_err());
        Ok(())
    }
}

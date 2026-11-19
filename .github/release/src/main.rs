use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{env, error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let [dir, version, repo] = args.as_slice() else {
        return Err("Expected asset directory, version and GitHub repository".into());
    };
    let dir = Path::new(dir);
    let config: Value = serde_json::from_slice(&fs::read("src-tauri/tauri.conf.json")?)?;
    let pubkey = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing public key")?;
    let key = PublicKey::decode(&String::from_utf8(STANDARD.decode(pubkey)?)?)?;
    let manifest: Value = serde_json::from_slice(&fs::read(dir.join("latest.json"))?)?;
    if manifest["version"].as_str() != Some(version) {
        return Err("Unexpected manifest version".into());
    }
    let filename = format!("Accountant.Util_{version}_x64-setup.exe");
    let url = format!("https://github.com/{repo}/releases/download/v{version}/{filename}");
    let signature = fs::read_to_string(dir.join(format!("{filename}.sig")))?;
    let platforms = &manifest["platforms"];
    for target in ["windows-x86_64", "windows-x86_64-nsis"] {
        if target.ends_with("-nsis") && platforms.get(target).is_none() {
            continue;
        }
        if platforms[target]["url"].as_str() != Some(url.as_str())
            || platforms[target]["signature"].as_str().map(str::trim) != Some(signature.trim())
        {
            return Err(format!("Wrong installer URL or signature for {target}").into());
        }
    }
    let sig = Signature::decode(&String::from_utf8(STANDARD.decode(signature.trim())?)?)?;
    key.verify(&fs::read(dir.join(filename))?, &sig, false)?;
    let version_field = format!("version:{version}");
    if !sig
        .trusted_comment()
        .split('\t')
        .any(|field| field == version_field)
    {
        return Err("Signed version does not match the manifest".into());
    }
    println!("Verified Windows installer, signature and manifest for {version}.");
    Ok(())
}

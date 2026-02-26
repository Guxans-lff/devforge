use crate::utils::error::AppError;

const SERVICE_NAME: &str = "devforge";

pub struct CredentialManager;

impl CredentialManager {
    pub fn save(connection_id: &str, password: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        entry
            .set_password(password)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        Ok(())
    }

    pub fn get(connection_id: &str) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Credential(e.to_string())),
        }
    }

    pub fn delete(connection_id: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE_NAME, connection_id)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Credential(e.to_string())),
        }
    }
}

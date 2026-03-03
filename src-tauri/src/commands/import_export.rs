use crate::commands::connection::StorageState;
use crate::models::import_export::*;
use crate::services::import_export::ImportExportService;
use tauri::State;

#[tauri::command]
pub async fn export_connections(
    state: State<'_, StorageState>,
    connection_ids: Option<Vec<String>>,
) -> Result<ConnectionExport, String> {
    let service = ImportExportService::new(&state);
    service
        .export_connections(connection_ids)
        .await
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
pub async fn preview_import(
    state: State<'_, StorageState>,
    data: ConnectionExport,
) -> Result<ImportPreview, String> {
    let service = ImportExportService::new(&state);
    service
        .preview_import(data)
        .await
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
pub async fn import_connections(
    state: State<'_, StorageState>,
    data: ConnectionExport,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let service = ImportExportService::new(&state);
    service
        .import_connections(data, options)
        .await
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
pub async fn import_navicat_xml(
    _xml_content: String,
) -> Result<ConnectionExport, String> {
    // TODO: 实现 Navicat XML 解析
    Err("Navicat import not implemented yet".to_string())
}

#[tauri::command]
pub async fn import_termius_json(
    _json_content: String,
) -> Result<ConnectionExport, String> {
    // TODO: 实现 Termius JSON 解析
    Err("Termius import not implemented yet".to_string())
}

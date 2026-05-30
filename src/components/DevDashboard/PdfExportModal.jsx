import React, { useState } from 'react';
import styles from './styles.module.css';

/**
 * PdfExportModal - Modal for selecting dashboard tiles to export as PDF
 * Props:
 *   open (bool): Whether the modal is visible
 *   onClose (func): Called to close the modal
 *   tileMeta (object): Map of tile keys to { title, icon, description }
 *   onExport (func): Called with selected tile keys when export is triggered
 */
export default function PdfExportModal({ open, onClose, tileMeta, onExport }) {
  const [selected, setSelected] = useState([]);
  const [progress, setProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [complete, setComplete] = useState(false);

  if (!open) return null;

  const tileKeys = Object.keys(tileMeta);

  const handleSelectAll = () => setSelected(tileKeys);
  const handleClearAll = () => setSelected([]);
  const handleToggle = (key) => {
    setSelected(selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key]);
  };
  const handleExport = async () => {
    setGenerating(true);
    setProgress(0);
    setComplete(false);
    // Simulate progress
    for (let i = 1; i <= 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      setProgress(i * 10);
    }
    setGenerating(false);
    setComplete(true);
    if (onExport) onExport(selected);
    // TODO: Implement PDF download logic here or connect to backend endpoint.
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal} style={{ minWidth: 320, maxWidth: '90vw', padding: '2rem' }}>
        <h2 className={styles.panelTitle} style={{ marginBottom: 16 }}>Select Tiles to Export</h2>
        <div className={styles.v2SelectList} style={{ marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
          {tileKeys.map((key) => (
            <label key={key} className={styles.v2SelectItem} style={{ display: 'block', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={() => handleToggle(key)}
                style={{ marginRight: 8 }}
              />
              {tileMeta[key].title}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className={styles.exportPdfButton} onClick={handleSelectAll} type="button">Select All</button>
          <button className={styles.exportPdfButton} onClick={handleClearAll} type="button">Clear All</button>
          <button className={styles.exportPdfButton} onClick={handleExport} type="button" disabled={generating || selected.length === 0}>Generate PDF</button>
          <button className={styles.v2ControlButton} onClick={onClose} type="button">Close</button>
        </div>
        {generating && (
          <div className={styles.v2Progress} style={{ marginTop: 12 }}>
            <div>Generating PDF... {progress}%</div>
            <progress value={progress} max="100" style={{ width: '100%' }} />
          </div>
        )}
        {complete && <div className={styles.v2Success} style={{ marginTop: 12 }}>PDF generation complete!</div>}
      </div>
    </div>
  );
}

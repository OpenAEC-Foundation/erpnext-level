import { useEffect, useState } from "react";
import { fetchAttachments, type FileInfo } from "../lib/erpnext";
import { X, Paperclip, FileText, Download, ExternalLink } from "lucide-react";

interface InvoiceModalProps {
  doctype: string;
  name: string;
  title: string;
  onClose: () => void;
}

export default function InvoiceModal({
  doctype,
  name,
  title,
  onClose,
}: InvoiceModalProps) {
  const [attachments, setAttachments] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const files = await fetchAttachments(doctype, name);
        setAttachments(files);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fout bij laden bijlagen");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [doctype, name]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const baseUrl = localStorage.getItem("erpnext_url") || "https://3bm.prilk.cloud";
  const erpnextUrl = `${baseUrl}/app/${doctype.toLowerCase().replace(/ /g, "-")}/${name}`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{name}</h3>
            <p className="text-sm text-slate-500">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg cursor-pointer"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1">
          <div className="mb-4">
            <a
              href={erpnextUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-3bm-teal hover:text-3bm-teal-dark"
            >
              <ExternalLink size={14} />
              Openen in ERPNext
            </a>
          </div>

          <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
            <Paperclip size={16} />
            Bijlagen
          </h4>

          {loading ? (
            <p className="text-sm text-slate-400">Laden...</p>
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-slate-400">Geen bijlagen gevonden</p>
          ) : (
            <div className="space-y-2">
              {attachments.map((file) => {
                const fileUrl = `/api/method/frappe.client.get_file?file_url=${encodeURIComponent(file.file_url)}`;
                const isPdf = file.file_name?.toLowerCase().endsWith(".pdf");
                const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(
                  file.file_name || ""
                );

                return (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                  >
                    <div className="p-2 bg-white rounded-lg border border-slate-200">
                      <FileText size={18} className="text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {file.file_name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatSize(file.file_size)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {(isPdf || isImage) && (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 hover:bg-slate-200 rounded-lg"
                          title="Bekijken"
                        >
                          <ExternalLink size={16} className="text-3bm-teal" />
                        </a>
                      )}
                      <a
                        href={fileUrl}
                        download={file.file_name}
                        className="p-2 hover:bg-slate-200 rounded-lg"
                        title="Downloaden"
                      >
                        <Download size={16} className="text-slate-500" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

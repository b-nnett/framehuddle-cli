import type { ImportFile } from "./schema";
export type LoadedExport = {
  id: string;
  status: string;
  export: ImportFile["export"];
  screens: (ImportFile["screens"][number] & { imageUrl: string; thumbnail?: string })[];
};
export type Comment = {
  referenceExportId?: string | null;
  reference?: {exportId:string;version:string;screenTitle:string;section?:string[];width:number;height:number;imageUrl:string} | null;
  deletedAt?: string | null;
  mentions?: string[];
  id: string;
  exportId: string;
  screenId: string;
  parentId: string | null;
  body: string;
  x: number;
  y: number;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  name: string;
  image: string | null;
};

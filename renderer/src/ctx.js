import { createContext, useContext } from "react";

export const api = window.api;
export const AppCtx = createContext(null);

export function useApp() {
  return useContext(AppCtx);
}
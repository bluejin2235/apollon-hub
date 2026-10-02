"use client";
import { createContext, useContext } from "react";
export const LunaWorkspaceContext = createContext({ name: "" });
export const useLunaWorkspace = () => useContext(LunaWorkspaceContext);

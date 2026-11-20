// Escenarios de entrenamiento: el bot adapta las preguntas al puesto, tipo de entrevista y nivel.
export const JOBS: { id: string; label: string; focus: string }[] = [
  { id: "mine", label: "Mi puesto objetivo (Ajustes)", focus: "" },
  { id: "backend", label: "Desarrollador/a Backend", focus: "Backend: APIs, bases de datos, diseño de sistemas, testing, rendimiento, seguridad básica" },
  { id: "frontend", label: "Desarrollador/a Frontend", focus: "Frontend: JavaScript/TypeScript, frameworks, accesibilidad, rendimiento web, testing de UI" },
  { id: "fullstack", label: "Full Stack", focus: "Full stack: de la UI a la base de datos, arquitectura, despliegue y trade-offs" },
  { id: "banking", label: "Desarrollo en banca / fintech", focus: "Software en banca/fintech: sistemas críticos, pagos, fiabilidad, seguridad, regulación y trabajo en equipos grandes" },
  { id: "devops", label: "DevOps / SRE", focus: "DevOps/SRE: CI/CD, cloud, contenedores, observabilidad, gestión de incidentes y fiabilidad" },
  { id: "data", label: "Datos (Data Engineer/Analyst)", focus: "Datos: SQL, pipelines, modelado, calidad de datos, visualización y comunicación de insights" },
  { id: "qa", label: "QA / Automatización de pruebas", focus: "QA: estrategia de testing, automatización, calidad en CI, detección de bugs y trabajo con desarrollo" },
  { id: "mobile", label: "Desarrollo móvil", focus: "Móvil: iOS/Android o multiplataforma, ciclo de vida, rendimiento, publicación en stores" },
  { id: "security", label: "Ciberseguridad", focus: "Ciberseguridad: amenazas, hardening, respuesta a incidentes, gestión de vulnerabilidades" },
  { id: "pm", label: "Product / Project Manager", focus: "Producto/proyectos: priorización, stakeholders, roadmap, métricas, gestión de riesgos y conflictos" },
  { id: "analyst", label: "Analista funcional / de negocio", focus: "Análisis: requisitos, procesos, comunicación con negocio y tecnología, documentación" },
  { id: "support", label: "Soporte técnico / Customer Success", focus: "Soporte: resolución de problemas, comunicación con clientes, priorización, empatía bajo presión" },
];

export const KINDS: { id: string; label: string; focus: string }[] = [
  { id: "mixta", label: "Mixta", focus: "mezcla de comportamiento, técnica y motivación" },
  { id: "rrhh", label: "RR. HH. / comportamiento", focus: "solo comportamiento y motivación (método STAR), sin preguntas técnicas" },
  { id: "tecnica", label: "Técnica", focus: "solo preguntas técnicas y de resolución de problemas sobre su stack y sus proyectos" },
];

export const LEVELS: { id: string; label: string }[] = [
  { id: "junior", label: "Junior" },
  { id: "medio", label: "Medio" },
  { id: "senior", label: "Senior" },
];

export interface PracticeOptions {
  job?: string;
  custom?: string;
  kind?: string;
  level?: string;
}

export function focusLine(o: PracticeOptions = {}): string {
  const job = o.custom?.trim() || JOBS.find((j) => j.id === o.job)?.focus || "";
  const kind = KINDS.find((k) => k.id === o.kind)?.focus ?? KINDS[0].focus;
  const level = LEVELS.find((l) => l.id === o.level)?.label ?? "";
  const parts = [job && `Puesto del simulacro: ${job}`, `Tipo de entrevista: ${kind}`, level && `Nivel exigido: ${level}`];
  return parts.filter(Boolean).join(". ");
}

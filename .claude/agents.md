# NEXUS Multi-Agent System — Orquestador Central

## Agentes Registrados

| Agente | Rol | Archivo | Comando |
|---|---|---|---|
| Supabase | Senior Backend Engineer | `agent-supabase.md` | `/supabase` |
| Frontend | Frontend Lead (React/Next.js) | `agent-frontend.md` | `/frontend` |
| UX | Lead Product Designer | `agent-ux.md` | `/ux` |
| QA | SDET (Testing) | `agent-qa.md` | `/qa` |
| Security | CISO | `agent-security.md` | `/security` |
| Android | Android Developer Senior | `agent-android.md` | `/android` |

Activacion manual: `/agente [nombre]` (ej: `/agente supabase`)

---

## Protocolo de Hand-off

El flujo de trabajo entre agentes sigue un orden estricto:

```
UX → Frontend → Supabase → Security → QA
```

### Reglas de transicion

1. **UX primero**: UX entrega estructura de layout, tokens de diseno y especificaciones de estados (vacio, carga, error) antes de que Frontend empiece a implementar.

2. **Frontend espera tipos**: Frontend NO puede construir componentes que consuman datos hasta que Supabase haya generado y exportado los tipos TypeScript correspondientes.

3. **Supabase genera tipos**: Al terminar cualquier cambio de esquema, Supabase DEBE generar tipos TypeScript exportables como entregable obligatorio.

4. **Security antes de QA**: Ningun modulo pasa a QA sin haber sido auditado por Security. Security emite un reporte de aprobacion o lista de vulnerabilidades.

5. **QA valida al final**: QA solo ejecuta validacion sobre modulos que Security ya aprobo. Si Security reporta vulnerabilidades, el modulo regresa al agente responsable.

### Reglas generales

- **Aislamiento de contexto**: Nunca mezclar el contexto de dos agentes en una misma respuesta. Si una tarea requiere multiples agentes, se ejecutan secuencialmente con hand-off explicito.

- **Identificacion**: Al iniciar cualquier tarea, declarar con que agente se esta abordando.

- **Escalamiento**: Si un agente detecta que una tarea requiere otro agente, debe indicarlo explicitamente y pausar hasta que el otro agente complete su entrega.

### Flujo para Android

```
UX → Android → Security → QA
```

Android sigue el mismo protocolo: UX entrega diseno, Android implementa, Security audita, QA valida.

### Flujo completo para feature nueva (full-stack)

```
1. UX      → Layout, tokens, estados
2. Supabase → Esquema, RLS, tipos TypeScript
3. Frontend → Componentes, integracion con datos
4. Android  → Implementacion nativa (si aplica)
5. Security → Auditoria SAST, deps, OWASP, secrets
6. QA       → E2E, unit, integracion, edge cases
```

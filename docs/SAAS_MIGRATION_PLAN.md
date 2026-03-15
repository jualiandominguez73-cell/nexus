# Plan de Migración SaaS (Multi-Tenant) para OpenGravity

## Objetivo
Transformar la plataforma monolítica (Mono-usuario) de OpenGravity en un modelo SaaS (Software as a Service) Multi-Tenant. Esto permitirá rentar agentes de IA a múltiples empresas y clientes, asignando a cada uno su propio número de teléfono, cuenta de WhatsApp, configuraciones, contexto aislado y subdominio.

## Pilares Arquitectónicos a Modificar

### 1. Sistema de Inquilinos (Multi-Tenancy) en la Base de Datos
- **Entidad Core:** Crear una nueva tabla, documento o colección `Tenant` (Cliente).
- **Aislamiento de Datos Estratégico:** Agregar la propiedad/columna `tenantId` a **todas** las entidades persistentes (ej. `Contacts`, `MemoryThreads`, `Settings`). 
- **Regla Estricta:** Toda consulta de lectura, escritura o búsqueda a la base de datos debe ser obligatoriamente filtrada por `tenantId`.

### 2. Eliminación de `.env` Estático (Credenciales Dinámicas - BYOK)
- **El Problema:** Actualmente las API Keys (Twilio, Groq, OpenAI, ElevenLabs) están fijas en el archivo `.env`.
- **La Solución:** Mover estas configuraciones a la tabla `Tenant` (Settings específicos por cliente).
- **Implementación (Al Vuelo):** Las funciones del agente ya no importarán directamente `env.ts`. El servidor instanciará Twilio, Groq y OpenRouter "al vuelo" leyendo las contraseñas encriptadas desde la base de datos basándose en la llamada en curso. Cada cliente definirá ahí su propio System Prompt Maestro (comportamiento de su IA).

### 3. Subdominios Dinámicos y Enrutamiento de Webhooks
- **Infraestructura DNS:** Configuración de un Wildcard DNS (`*.opengravity.ai`) apuntando a tu servidor único/clúster.
- **Middleware Express:** Un interceptor raíz leerá el host de entrada (`req.hostname`).
- **Resolución:** Si un webhook entra a `clinica.opengravity.ai/api/twilio/voice`, el middleware inyectará en la sesión el Contexto de Base de Datos correspondiente a la clínica (basado en el subdominio).

### 4. Multiplexación de Teléfonos y WhatsApp (Twilio)
- **Identificación por Destino:** Una capa de seguridad que lee el número al que llamó la persona (`req.body.To`) en Twilio. 
- Mapeará el número de teléfono entrante directamente al `tenantId` dueño de esa línea celular. A partir de esa capa inicial, se carga su memoria y rutinas.

### 5. Panel de Control Web (SaaS Dashboard)
- Sustituir la exclusividad de Telegram como panel de administración.
- Crear un frontend (Dashboard SaaS) donde el **cliente final** inicie sesión.
- Funciones del Panel de Cliente:
  - Enlazar la cuenta con sus credenciales o rentar la suscripción.
  - Editar su "Prompt Base" (ej. "Eres el soporte técnico para Empresa X").
  - Elegir qué voz de IA utilizar.
  - Revisar historiales y la agenda inteligente de contactos extraídos de las llamadas y WhatsApps hechos por el bot.

---

## Hoja de Ruta de Ejecución (Fases)

### Fase 1: Desacoplamiento del archivo `.env` 
Extraer la dependencia estática hacia instancias pasadas como parámetro a cada función (`TenantContext`), preparando a los archivos (LLM, Twilio, TTS) para trabajar de acuerdo al cliente dueño de la petición, no del entorno global del servidor.

### Fase 2: Implementación de Tenant IDs en DB Persistente
Rediseñar `runAgentLoop`, `memoryDb` y `contactsDb` para requerir el parámetro `tenantId`. Por el momento, asignaríamos un cliente por defecto para no romper el flujo existente mientras migramos.

### Fase 3: El Enrutador Exprés (Middleware Multicliente)
Programar el ruteador perimetral en `server.ts`. Toda llamada entrante desde Twilio WebSockets o WhatsApp evaluará a quién están contactando y ramificará la ejecución utilizando las instrucciones correspondientes.

### Fase 4: Desarrollo del Front-End del Dashboard SaaS
API de Altas de usuarios, registro de subdominios, almacenamiento de Prompts seguros, despliegue del Portal de Gestión de Clientes.

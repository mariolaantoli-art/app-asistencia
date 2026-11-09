# PRD – Control de Asistencia Clases Funcionales

## Problema original
App móvil para controlar asistencia de clases funcionales (martes y jueves, oct 2026 – jun 2027). Lista de alumnos con clases/dinero restante del bono, botón verde "Registrar Asistencia" por alumno asociado al día de clase, resta 1 clase (2€) y guarda historial con fecha y hora, añadir alumnos con bono inicial, datos persistentes.

## Decisiones del usuario
- Bonos: 10€ = 5 clases, 20€ = 10 clases (2€/clase, sin pago suelto)
- Historial con opción de deshacer
- Almacenamiento en la nube (MongoDB), interfaz en español
- Coste real 4€/sesión: 2€ alumno + 2€ ayuntamiento; resumen mensual por alumno

## Arquitectura
- Backend FastAPI + MongoDB: students, attendance (índice único student_id+class_date, descuento atómico)
- Endpoints: /api/students (CRUD + renew), /api/attendance (POST/DELETE/GET), /api/summary/monthly, /api/class-days
- Frontend Expo Router, 3 pestañas: Alumnos, Historial, Resumen

## Implementado (2026-11-09)
- Lista de alumnos con selector de día de clase (martes/jueves del curso), botón verde Registrar Asistencia, estado "Asistió"/"Sin bono"
- Añadir alumno (bono 10€/20€), renovar bono, eliminar con confirmación
- Historial agrupado por fecha con hora y Deshacer (doble toque)
- Resumen mensual: total, parte alumnos, parte ayuntamiento, desglose por alumno
- Probado: backend 25/25, flujos frontend OK; bugs del informe corregidos

## Implementado (2026-11-09, iteración 2)
- Pantalla de bienvenida: "Soy alumno" (inscripción pública) / "Soy el monitor" (PIN)
- Inscripción pública: nombre, teléfono, email, observaciones de salud → queda pendiente
- Gestión protegida con PIN (ADMIN_PIN en backend/.env), token 30 días, bloqueo tras 5 fallos (por IP) y tope global de 30/15 min
- Pantalla Inscripciones: aprobar con bono 10€/20€ o rechazar (rechazo no borra)
- Ficha del alumno con teléfono, email y salud (icono si tiene observaciones)

## Backlog
- 2026-11-09 iteración 3: marcar días como Festivo/Suspendida (bloquea asistencias); zona alumno "Registrar mi clase" con nombre + código personal de 4 cifras (visible en ficha), hoy o días anteriores, muestra saldo; historial indica "registrado por el alumno"
- Datos: 57 alumnos ya inscritos cargados sin bono (seed_alumnos.py, idempotente) – 2026-11-09
- P1: Exportar resumen mensual a PDF/Excel para el ayuntamiento
- P1: Aviso de bono a punto de agotarse
- P2: Búsqueda de alumnos, días festivos sin clase, acceso con contraseña

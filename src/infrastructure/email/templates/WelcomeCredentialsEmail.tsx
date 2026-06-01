import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { EmailLayout } from './EmailLayout';

export interface WelcomeCredentialsEmailProps {
    name: string;
    email: string;
    temporaryPassword: string;
    buildingName: string;
    /** Human-readable role label, e.g. "Miembro de Junta", "Residente". */
    roleLabel: string;
    loginUrl: string;
}

const headingStyle: React.CSSProperties = {
    fontSize: '22px',
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 8px 0',
};

const bodyText: React.CSSProperties = {
    fontSize: '15px',
    color: '#374151',
    lineHeight: '1.6',
    margin: '0 0 16px 0',
};

const credentialsBox: React.CSSProperties = {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    margin: '20px 0',
};

const credentialLabel: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    margin: '0 0 4px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
};

const credentialValue: React.CSSProperties = {
    fontSize: '16px',
    color: '#111827',
    fontFamily: 'monospace',
    margin: '0 0 16px 0',
    fontWeight: 600,
};

const warningText: React.CSSProperties = {
    fontSize: '13px',
    color: '#b45309',
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    padding: '12px',
    margin: '16px 0',
};

const buttonStyle: React.CSSProperties = {
    backgroundColor: '#1a56db',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 28px',
    textDecoration: 'none',
    display: 'inline-block',
};

export function WelcomeCredentialsEmail({
    name,
    email,
    temporaryPassword,
    buildingName,
    roleLabel,
    loginUrl,
}: WelcomeCredentialsEmailProps) {
    return (
        <EmailLayout preview={`Bienvenido a ${buildingName} — tus credenciales de acceso`}>
            <Text style={headingStyle}>Bienvenido a {buildingName}</Text>
            <Text style={bodyText}>
                Hola <strong>{name}</strong>, has sido registrado como <strong>{roleLabel}</strong> en{' '}
                <strong>{buildingName}</strong>. A continuación encontrarás tus credenciales de acceso:
            </Text>

            <Section style={credentialsBox}>
                <Text style={credentialLabel}>Correo electrónico</Text>
                <Text style={credentialValue}>{email}</Text>
                <Text style={credentialLabel}>Contraseña temporal</Text>
                <Text style={credentialValue}>{temporaryPassword}</Text>
            </Section>

            <Text style={warningText}>
                ⚠️ <strong>Importante:</strong> Esta contraseña es temporal. Deberás cambiarla la primera vez
                que inicies sesión. No compartas esta información con nadie.
            </Text>

            <Button href={loginUrl} style={buttonStyle}>
                Iniciar sesión
            </Button>
        </EmailLayout>
    );
}

import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { EmailLayout } from './EmailLayout';

export interface ResidentApprovedEmailProps {
    name: string;
    email: string;
    temporaryPassword: string;
    unitName: string;
    buildingName: string;
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
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
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
    backgroundColor: '#16a34a',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 28px',
    textDecoration: 'none',
    display: 'inline-block',
};

export function ResidentApprovedEmail({
    name,
    email,
    temporaryPassword,
    unitName,
    buildingName,
    loginUrl,
}: ResidentApprovedEmailProps) {
    return (
        <EmailLayout preview={`¡Aprobado! Accede a Condominio — ${buildingName}`}>
            <Text style={headingStyle}>¡Tu solicitud fue aprobada! 🎉</Text>
            <Text style={bodyText}>
                Hola <strong>{name}</strong>, tu solicitud de ingreso a la unidad <strong>{unitName}</strong> en
                el edificio <strong>{buildingName}</strong> ha sido <strong>aprobada</strong>.
                Aquí están tus credenciales de acceso:
            </Text>

            <Section style={credentialsBox}>
                <Text style={credentialLabel}>Correo electrónico</Text>
                <Text style={credentialValue}>{email}</Text>
                <Text style={credentialLabel}>Contraseña temporal</Text>
                <Text style={credentialValue}>{temporaryPassword}</Text>
            </Section>

            <Text style={warningText}>
                ⚠️ <strong>Importante:</strong> Esta contraseña es temporal. Deberás cambiarla la primera vez que inicies sesión.
                No compartas esta información con nadie.
            </Text>

            <Button href={loginUrl} style={buttonStyle}>
                Iniciar sesión ahora
            </Button>
        </EmailLayout>
    );
}

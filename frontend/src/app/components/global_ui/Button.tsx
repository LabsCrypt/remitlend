import React from "react";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

const Button: React.FC<ButtonProps> = ({ children, onClick }) => {
  return (
    <button onClick={onClick} className="px-4 py-2 bg-blue-600 text-white rounded-md">
      {children}
    </button>
  );
};

export default Button;

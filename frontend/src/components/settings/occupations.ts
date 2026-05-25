export interface OccupationNode {
  slug: string;
  name: string;
  children?: OccupationNode[];
}

export const OCCUPATIONS: OccupationNode[] = [
  {
    "slug": "management-occupations",
    "name": "Management Occupations",
    "children": [
      {
        "slug": "top-executives",
        "name": "Top Executives"
      },
      {
        "slug": "advertising-marketing-promotions-public-relations-and-sales-managers",
        "name": "Advertising, Marketing, Promotions, Public Relations, and Sales Managers"
      },
      {
        "slug": "operations-specialties-managers",
        "name": "Operations Specialties Managers"
      },
      {
        "slug": "other-management-occupations",
        "name": "Other Management Occupations"
      }
    ]
  },
  {
    "slug": "business-and-financial-operations-occupations",
    "name": "Business and Financial Operations Occupations",
    "children": [
      {
        "slug": "business-operations-specialists",
        "name": "Business Operations Specialists"
      },
      {
        "slug": "financial-specialists",
        "name": "Financial Specialists"
      }
    ]
  },
  {
    "slug": "computer-and-mathematical-occupations",
    "name": "Computer and Mathematical Occupations",
    "children": [
      {
        "slug": "computer-occupations",
        "name": "Computer Occupations"
      },
      {
        "slug": "mathematical-science-occupations",
        "name": "Mathematical Science Occupations"
      }
    ]
  },
  {
    "slug": "architecture-and-engineering-occupations",
    "name": "Architecture and Engineering Occupations",
    "children": [
      {
        "slug": "architects-surveyors-and-cartographers",
        "name": "Architects, Surveyors, and Cartographers"
      },
      {
        "slug": "engineers",
        "name": "Engineers"
      },
      {
        "slug": "drafters-engineering-technicians-and-mapping-technicians",
        "name": "Drafters, Engineering Technicians, and Mapping Technicians"
      }
    ]
  },
  {
    "slug": "life-physical-and-social-science-occupations",
    "name": "Life, Physical, and Social Science Occupations",
    "children": [
      {
        "slug": "life-scientists",
        "name": "Life Scientists"
      },
      {
        "slug": "physical-scientists",
        "name": "Physical Scientists"
      },
      {
        "slug": "social-scientists-and-related-workers",
        "name": "Social Scientists and Related Workers"
      },
      {
        "slug": "life-physical-and-social-science-technicians",
        "name": "Life, Physical, and Social Science Technicians"
      },
      {
        "slug": "occupational-health-and-safety-specialists-and-technicians-195",
        "name": "Occupational Health and Safety Specialists and Technicians"
      }
    ]
  },
  {
    "slug": "community-and-social-service-occupations",
    "name": "Community and Social Service Occupations",
    "children": [
      {
        "slug": "counselors-social-workers-and-other-community-and-social-service-specialists",
        "name": "Counselors, Social Workers, and Other Community and Social Service Specialists"
      },
      {
        "slug": "religious-workers",
        "name": "Religious Workers"
      }
    ]
  },
  {
    "slug": "legal-occupations",
    "name": "Legal Occupations",
    "children": [
      {
        "slug": "lawyers-judges-and-related-workers",
        "name": "Lawyers, Judges, and Related Workers"
      },
      {
        "slug": "legal-support-workers",
        "name": "Legal Support Workers"
      }
    ]
  },
  {
    "slug": "educational-instruction-and-library-occupations",
    "name": "Educational Instruction and Library Occupations",
    "children": [
      {
        "slug": "postsecondary-teachers",
        "name": "Postsecondary Teachers"
      },
      {
        "slug": "preschool-elementary-middle-secondary-and-special-education-teachers",
        "name": "Preschool, Elementary, Middle, Secondary, and Special Education Teachers"
      },
      {
        "slug": "other-teachers-and-instructors",
        "name": "Other Teachers and Instructors"
      },
      {
        "slug": "librarians-curators-and-archivists",
        "name": "Librarians, Curators, and Archivists"
      },
      {
        "slug": "other-educational-instruction-and-library-occupations",
        "name": "Other Educational Instruction and Library Occupations"
      }
    ]
  },
  {
    "slug": "arts-design-entertainment-sports-and-media-occupations",
    "name": "Arts, Design, Entertainment, Sports, and Media Occupations",
    "children": [
      {
        "slug": "art-and-design-workers",
        "name": "Art and Design Workers"
      },
      {
        "slug": "entertainers-and-performers-sports-and-related-workers",
        "name": "Entertainers and Performers, Sports and Related Workers"
      },
      {
        "slug": "media-and-communication-workers",
        "name": "Media and Communication Workers"
      },
      {
        "slug": "media-and-communication-equipment-workers",
        "name": "Media and Communication Equipment Workers"
      }
    ]
  },
  {
    "slug": "healthcare-practitioners-and-technical-occupations",
    "name": "Healthcare Practitioners and Technical Occupations",
    "children": [
      {
        "slug": "healthcare-diagnosing-or-treating-practitioners",
        "name": "Healthcare Diagnosing or Treating Practitioners"
      },
      {
        "slug": "health-technologists-and-technicians",
        "name": "Health Technologists and Technicians"
      },
      {
        "slug": "other-healthcare-practitioners-and-technical-occupations",
        "name": "Other Healthcare Practitioners and Technical Occupations"
      }
    ]
  },
  {
    "slug": "healthcare-support-occupations",
    "name": "Healthcare Support Occupations",
    "children": [
      {
        "slug": "home-health-and-personal-care-aides-and-nursing-assistants-orderlies-and-psychiatric-aides",
        "name": "Home Health and Personal Care Aides; and Nursing Assistants, Orderlies, and Psychiatric Aides"
      },
      {
        "slug": "occupational-therapy-and-physical-therapist-assistants-and-aides",
        "name": "Occupational Therapy and Physical Therapist Assistants and Aides"
      },
      {
        "slug": "other-healthcare-support-occupations",
        "name": "Other Healthcare Support Occupations"
      }
    ]
  },
  {
    "slug": "protective-service-occupations",
    "name": "Protective Service Occupations",
    "children": [
      {
        "slug": "supervisors-of-protective-service-workers",
        "name": "Supervisors of Protective Service Workers"
      },
      {
        "slug": "firefighting-and-prevention-workers",
        "name": "Firefighting and Prevention Workers"
      },
      {
        "slug": "law-enforcement-workers",
        "name": "Law Enforcement Workers"
      },
      {
        "slug": "other-protective-service-workers",
        "name": "Other Protective Service Workers"
      }
    ]
  },
  {
    "slug": "food-preparation-and-serving-related-occupations",
    "name": "Food Preparation and Serving Related Occupations",
    "children": [
      {
        "slug": "supervisors-of-food-preparation-and-serving-workers-351",
        "name": "Supervisors of Food Preparation and Serving Workers"
      },
      {
        "slug": "cooks-and-food-preparation-workers",
        "name": "Cooks and Food Preparation Workers"
      },
      {
        "slug": "food-and-beverage-serving-workers",
        "name": "Food and Beverage Serving Workers"
      },
      {
        "slug": "other-food-preparation-and-serving-related-workers",
        "name": "Other Food Preparation and Serving Related Workers"
      }
    ]
  },
  {
    "slug": "building-and-grounds-cleaning-and-maintenance-occupations",
    "name": "Building and Grounds Cleaning and Maintenance Occupations",
    "children": [
      {
        "slug": "supervisors-of-building-and-grounds-cleaning-and-maintenance-workers",
        "name": "Supervisors of Building and Grounds Cleaning and Maintenance Workers"
      },
      {
        "slug": "building-cleaning-and-pest-control-workers",
        "name": "Building Cleaning and Pest Control Workers"
      },
      {
        "slug": "grounds-maintenance-workers-373",
        "name": "Grounds Maintenance Workers"
      }
    ]
  },
  {
    "slug": "personal-care-and-service-occupations",
    "name": "Personal Care and Service Occupations",
    "children": [
      {
        "slug": "supervisors-of-personal-care-and-service-workers",
        "name": "Supervisors of Personal Care and Service Workers"
      },
      {
        "slug": "animal-care-and-service-workers",
        "name": "Animal Care and Service Workers"
      },
      {
        "slug": "entertainment-attendants-and-related-workers",
        "name": "Entertainment Attendants and Related Workers"
      },
      {
        "slug": "funeral-service-workers",
        "name": "Funeral Service Workers"
      },
      {
        "slug": "personal-appearance-workers",
        "name": "Personal Appearance Workers"
      },
      {
        "slug": "baggage-porters-bellhops-and-concierges-396",
        "name": "Baggage Porters, Bellhops, and Concierges"
      },
      {
        "slug": "tour-and-travel-guides-397",
        "name": "Tour and Travel Guides"
      },
      {
        "slug": "other-personal-care-and-service-workers",
        "name": "Other Personal Care and Service Workers"
      }
    ]
  },
  {
    "slug": "sales-and-related-occupations",
    "name": "Sales and Related Occupations",
    "children": [
      {
        "slug": "supervisors-of-sales-workers",
        "name": "Supervisors of Sales Workers"
      },
      {
        "slug": "retail-sales-workers",
        "name": "Retail Sales Workers"
      },
      {
        "slug": "sales-representatives-services",
        "name": "Sales Representatives, Services"
      },
      {
        "slug": "sales-representatives-wholesale-and-manufacturing-414",
        "name": "Sales Representatives, Wholesale and Manufacturing"
      },
      {
        "slug": "other-sales-and-related-workers",
        "name": "Other Sales and Related Workers"
      }
    ]
  },
  {
    "slug": "office-and-administrative-support-occupations",
    "name": "Office and Administrative Support Occupations",
    "children": [
      {
        "slug": "supervisors-of-office-and-administrative-support-workers",
        "name": "Supervisors of Office and Administrative Support Workers"
      },
      {
        "slug": "communications-equipment-operators",
        "name": "Communications Equipment Operators"
      },
      {
        "slug": "financial-clerks",
        "name": "Financial Clerks"
      },
      {
        "slug": "information-and-record-clerks",
        "name": "Information and Record Clerks"
      },
      {
        "slug": "material-recording-scheduling-dispatching-and-distributing-workers",
        "name": "Material Recording, Scheduling, Dispatching, and Distributing Workers"
      },
      {
        "slug": "secretaries-and-administrative-assistants-436",
        "name": "Secretaries and Administrative Assistants"
      },
      {
        "slug": "other-office-and-administrative-support-workers",
        "name": "Other Office and Administrative Support Workers"
      }
    ]
  },
  {
    "slug": "farming-fishing-and-forestry-occupations",
    "name": "Farming, Fishing, and Forestry Occupations",
    "children": [
      {
        "slug": "supervisors-of-farming-fishing-and-forestry-workers",
        "name": "Supervisors of Farming, Fishing, and Forestry Workers"
      },
      {
        "slug": "agricultural-workers",
        "name": "Agricultural Workers"
      },
      {
        "slug": "fishing-and-hunting-workers-453",
        "name": "Fishing and Hunting Workers"
      },
      {
        "slug": "forest-conservation-and-logging-workers",
        "name": "Forest, Conservation, and Logging Workers"
      }
    ]
  },
  {
    "slug": "construction-and-extraction-occupations",
    "name": "Construction and Extraction Occupations",
    "children": [
      {
        "slug": "supervisors-of-construction-and-extraction-workers",
        "name": "Supervisors of Construction and Extraction Workers"
      },
      {
        "slug": "construction-trades-workers",
        "name": "Construction Trades Workers"
      },
      {
        "slug": "helpers-construction-trades-473",
        "name": "Helpers, Construction Trades"
      },
      {
        "slug": "other-construction-and-related-workers",
        "name": "Other Construction and Related Workers"
      },
      {
        "slug": "extraction-workers",
        "name": "Extraction Workers"
      }
    ]
  },
  {
    "slug": "installation-maintenance-and-repair-occupations",
    "name": "Installation, Maintenance, and Repair Occupations",
    "children": [
      {
        "slug": "supervisors-of-installation-maintenance-and-repair-workers",
        "name": "Supervisors of Installation, Maintenance, and Repair Workers"
      },
      {
        "slug": "electrical-and-electronic-equipment-mechanics-installers-and-repairers",
        "name": "Electrical and Electronic Equipment Mechanics, Installers, and Repairers"
      },
      {
        "slug": "vehicle-and-mobile-equipment-mechanics-installers-and-repairers",
        "name": "Vehicle and Mobile Equipment Mechanics, Installers, and Repairers"
      },
      {
        "slug": "other-installation-maintenance-and-repair-occupations",
        "name": "Other Installation, Maintenance, and Repair Occupations"
      }
    ]
  },
  {
    "slug": "production-occupations",
    "name": "Production Occupations",
    "children": [
      {
        "slug": "supervisors-of-production-workers",
        "name": "Supervisors of Production Workers"
      },
      {
        "slug": "assemblers-and-fabricators",
        "name": "Assemblers and Fabricators"
      },
      {
        "slug": "food-processing-workers",
        "name": "Food Processing Workers"
      },
      {
        "slug": "metal-workers-and-plastic-workers",
        "name": "Metal Workers and Plastic Workers"
      },
      {
        "slug": "printing-workers-5151",
        "name": "Printing Workers"
      },
      {
        "slug": "textile-apparel-and-furnishings-workers",
        "name": "Textile, Apparel, and Furnishings Workers"
      },
      {
        "slug": "woodworkers",
        "name": "Woodworkers"
      },
      {
        "slug": "plant-and-system-operators",
        "name": "Plant and System Operators"
      },
      {
        "slug": "other-production-occupations",
        "name": "Other Production Occupations"
      }
    ]
  },
  {
    "slug": "transportation-and-material-moving-occupations",
    "name": "Transportation and Material Moving Occupations",
    "children": [
      {
        "slug": "supervisors-of-transportation-and-material-moving-workers",
        "name": "Supervisors of Transportation and Material Moving Workers"
      },
      {
        "slug": "air-transportation-workers",
        "name": "Air Transportation Workers"
      },
      {
        "slug": "motor-vehicle-operators",
        "name": "Motor Vehicle Operators"
      },
      {
        "slug": "rail-transportation-workers",
        "name": "Rail Transportation Workers"
      },
      {
        "slug": "water-transportation-workers",
        "name": "Water Transportation Workers"
      },
      {
        "slug": "other-transportation-workers",
        "name": "Other Transportation Workers"
      },
      {
        "slug": "material-moving-workers",
        "name": "Material Moving Workers"
      }
    ]
  },
  {
    "slug": "military-specific-occupations",
    "name": "Military Specific Occupations",
    "children": [
      {
        "slug": "military-officer-special-and-tactical-operations-leaders-551",
        "name": "Military Officer Special and Tactical Operations Leaders"
      },
      {
        "slug": "first-line-enlisted-military-supervisors-552",
        "name": "First-Line Enlisted Military Supervisors"
      },
      {
        "slug": "military-enlisted-tactical-operations-and-air-weapons-specialists-and-crew-members-553",
        "name": "Military Enlisted Tactical Operations and Air/Weapons Specialists and Crew Members"
      }
    ]
  }
];
